#!/usr/bin/env python3
"""
Local ClickHouse for development and integration tests.

Runs the real ClickHouse engine in-process via chdb (https://github.com/chdb-io/chdb, pip install chdb)
and exposes the subset of the ClickHouse HTTP interface used by the official Node client
(@clickhouse/client) and by clickhouse-connect (used by the official mcp-clickhouse server):

  GET  /ping                             -> "Ok."
  GET/POST /?query=...&param_x=...       -> query in URL, optional inline INSERT data in body
  POST /                                 -> query in body (SELECT ... FORMAT X | DDL | INSERT ... FORMAT JSONEachRow\n<rows>)

Production deployments should point CLICKHOUSE_URL at ClickHouse Cloud or a ClickHouse server; this shim
exists only because the sandbox used to build CineMemory cannot run Docker or download binaries.

Usage:  python3 deploy/local-clickhouse/server.py --port 8123 --data ./data/clickhouse
"""
import argparse
import gzip
import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

try:
    from chdb import session as chsession
except ImportError:  # pragma: no cover
    print("chdb is not installed: pip install chdb", file=sys.stderr)
    sys.exit(1)

FORMAT_RE = re.compile(r"\s+FORMAT\s+([A-Za-z0-9_]+)\s*;?\s*$", re.IGNORECASE)
INSERT_RE = re.compile(r"^\s*INSERT\s+INTO", re.IGNORECASE)
LOCK = threading.Lock()


class Engine:
    def __init__(self, path: str):
        os.makedirs(path, exist_ok=True)
        self.session = chsession.Session(path)
        self.queries = 0

    def run(self, sql: str, params: dict, database: str | None, want_format: str | None):
        with LOCK:
            self.queries += 1
            for k, v in params.items():
                self.session.query(f"SET param_{k} = {sql_quote(v)}")
            if database and database != "default":
                self.session.query(f"USE {database}")
            fmt = want_format
            m = FORMAT_RE.search(sql)
            if m and not INSERT_RE.match(sql):
                fmt = m.group(1)
                sql = sql[: m.start()]
            if INSERT_RE.match(sql):
                res = self.session.query(sql)
            elif fmt:
                res = self.session.query(sql, fmt)
            else:
                res = self.session.query(sql, "TabSeparated")
            data = res.bytes() if hasattr(res, "bytes") else str(res).encode()
            rows = getattr(res, "rows_read", lambda: 0)()
            return data, rows


def sql_quote(v: str) -> str:
    return "'" + v.replace("\\", "\\\\").replace("'", "\\'") + "'"


def make_handler(engine: Engine):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # quieter
            if os.environ.get("CH_SHIM_VERBOSE"):
                super().log_message(fmt, *args)

        def _send(self, code: int, body: bytes, content_type="text/plain; charset=UTF-8", extra=None):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-ClickHouse-Server-Display-Name", "cinememory-local-chdb")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _body(self) -> bytes:
            if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
                chunks = []
                while True:
                    line = self.rfile.readline().strip()
                    size = int(line.split(b";")[0], 16) if line else 0
                    if size == 0:
                        # consume trailer + final CRLF
                        while True:
                            t = self.rfile.readline()
                            if t in (b"\r\n", b"\n", b""):
                                break
                        break
                    chunks.append(self.rfile.read(size))
                    self.rfile.readline()  # CRLF after chunk
                raw = b"".join(chunks)
            else:
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n) if n else b""
            if self.headers.get("Content-Encoding") == "gzip" and raw:
                raw = gzip.decompress(raw)
            return raw

        def do_GET(self):
            u = urlparse(self.path)
            if u.path == "/ping":
                return self._send(200, b"Ok.\n")
            qs = parse_qs(u.query)
            if u.path == "/" and "query" in qs:
                return self._execute(qs, b"")
            if u.path == "/":
                return self._send(200, b"Ok.\n")
            return self._send(404, b"not found\n")

        def do_POST(self):
            u = urlparse(self.path)
            qs = parse_qs(u.query)
            return self._execute(qs, self._body())

        def _execute(self, qs, body: bytes):
            query_param = qs.get("query", [None])[0]
            params = {k[6:]: v[0] for k, v in qs.items() if k.startswith("param_")}
            database = qs.get("database", [None])[0]
            default_format = qs.get("default_format", [None])[0]
            if query_param and body:
                sql = query_param.rstrip() + "\n" + body.decode("utf-8", "replace")
            elif query_param:
                sql = query_param
            else:
                sql = body.decode("utf-8", "replace")
            if not sql.strip():
                return self._send(400, b"empty query\n")
            try:
                data, rows = engine.run(sql, params, database, default_format)
                summary = json.dumps({"read_rows": str(rows), "read_bytes": "0", "written_rows": "0", "written_bytes": "0", "total_rows_to_read": "0", "result_rows": "0", "result_bytes": "0", "elapsed_ns": "0"})
                self._send(200, data, extra={"X-ClickHouse-Summary": summary, "X-ClickHouse-Query-Id": qs.get("query_id", ["local"])[0]})
            except Exception as e:  # ClickHouse returns 500 with the exception text
                msg = str(e).encode()
                self._send(500, msg, extra={"X-ClickHouse-Exception-Code": "1"})

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("CH_PORT", "8123")))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--data", default=os.environ.get("CH_DATA", "./data/clickhouse"))
    args = ap.parse_args()
    engine = Engine(os.path.abspath(args.data))
    version = engine.run("SELECT version()", {}, None, "TabSeparated")[0].decode().strip()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(engine))
    print(f"[local-clickhouse] ClickHouse {version} (chdb) listening on http://{args.host}:{args.port}  data={os.path.abspath(args.data)}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
