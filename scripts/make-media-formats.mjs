// 由 examples/media/ 下的 images/sunset.png、videos/sunrise.mp4、images/loading.gif 转出更多图片 / 视频 / 音频格式
// 用法：npm run examples:formats（需要先 npm install；ffmpeg 来自 devDependencies 中的 ffmpeg-static）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const dir = fileURLToPath(new URL('../examples/media/', import.meta.url));
const src = (n) => join(dir, n);
for (const n of ['images/sunset.png', 'videos/sunrise.mp4', 'images/loading.gif']) {
  if (!existsSync(src(n))) {
    console.error(`缺少 ${n}，请先运行 npm run examples:media（macOS）`);
    process.exit(1);
  }
}
for (const sub of ['images', 'videos', 'audio']) mkdirSync(src(sub), { recursive: true });

// 参数用数组传给 execFile，不经过 shell
const run = (out, args) => {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args, src(out)], { stdio: 'inherit' });
  console.log(`  ${out.padEnd(22)} ${(statSync(src(out)).size / 1024).toFixed(1)} KB`);
};
const still = ['-i', src('images/sunset.png')];
const small = ['-vf', 'scale=600:-2'];

console.log('图片：');
run('images/sunset.webp', [...still, '-c:v', 'libwebp', '-quality', '80']);
run('images/sunset.avif', [...still, '-c:v', 'libaom-av1', '-still-picture', '1', '-crf', '32', '-cpu-used', '6', '-pix_fmt', 'yuv420p']);
run('images/sunset-small.jpeg', [...still, ...small, '-q:v', '4']);
run('images/sunset.tiff', [...still, ...small, '-compression_algo', 'deflate']);
run('images/dots.webp', ['-i', src('images/loading.gif'), '-c:v', 'libwebp_anim', '-loop', '0', '-quality', '75']);
run('images/dots.apng', ['-i', src('images/loading.gif'), '-plays', '0', '-f', 'apng']);

console.log('视频：');
const clip = ['-i', src('videos/sunrise.mp4'), '-an'];
run('videos/sunrise.webm', [...clip, '-c:v', 'libvpx-vp9', '-b:v', '400k', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4']);
run('videos/sunrise.mov', [...clip, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart']);
run('videos/sunrise-av1.mp4', [...clip, '-c:v', 'libaom-av1', '-crf', '40', '-b:v', '0', '-cpu-used', '8', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']);
run('videos/sunrise.m4v', [...clip, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart']);

console.log('音频：');
// 3 秒的「叮—咚」提示音：两个正弦波，带淡入淡出
const tone = ['-f', 'lavfi', '-i', 'sine=frequency=880:duration=1.2', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=1.8',
  '-filter_complex', '[0][1]concat=n=2:v=0:a=1,afade=t=in:d=0.05,afade=t=out:st=2.4:d=0.6,volume=0.6[a]', '-map', '[a]'];
run('audio/chime.mp3', [...tone, '-c:a', 'libmp3lame', '-b:a', '96k']);
run('audio/chime.ogg', [...tone, '-c:a', 'libvorbis', '-q:a', '3']);
run('audio/chime.opus', [...tone, '-c:a', 'libopus', '-b:a', '48k']);
run('audio/chime.m4a', [...tone, '-c:a', 'aac', '-b:a', '96k']);
run('audio/chime.wav', [...tone, '-ar', '22050', '-ac', '1']);
run('audio/chime.flac', [...tone, '-ar', '22050', '-ac', '1', '-c:a', 'flac']);

