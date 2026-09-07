import { execFile, spawn } from "node:child_process";

let cached: string | null | undefined;

/** ffmpeg binary: FFMPEG_PATH, then `ffmpeg` on PATH, then the static binary from the imageio-ffmpeg pip package. */
export async function resolveFfmpeg(): Promise<string | null> {
  if (cached !== undefined) return cached;
  const works = (bin: string) => new Promise<boolean>((resolve) => {
    const p = spawn(bin, ["-version"]);
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
  for (const bin of [process.env.FFMPEG_PATH, "ffmpeg"].filter((x): x is string => !!x)) if (await works(bin)) return (cached = bin);
  const py = await new Promise<string | null>((resolve) => execFile("python3", ["-c", "import imageio_ffmpeg,sys;sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())"], (err, out) => resolve(err ? null : out.trim())));
  if (py && (await works(py))) return (cached = py);
  return (cached = null);
}

export function ffmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ["-hide_banner", "-loglevel", "error", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-600) || `ffmpeg exited with ${code}`))));
  });
}

/** Last frame of a clip as JPEG bytes (used by the Visual Critic to check that nothing drifted during the clip). */
export async function lastFrame(bin: string, videoPath: string, outPath: string): Promise<void> {
  await ffmpeg(bin, ["-y", "-sseof", "-0.3", "-i", videoPath, "-vframes", "1", "-q:v", "2", outPath]);
}
