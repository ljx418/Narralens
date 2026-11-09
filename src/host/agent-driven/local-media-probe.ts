import { spawn } from 'node:child_process';
import { validateImportedMedia } from '../assets/media-validator.js';
import { localMediaArgs } from '../render/media-process-policy.mjs';
import { asHostResourceError } from '../api-error.js';
import { ProductError } from '../creative/trusted-context.js';
export interface LocalMediaFacts {
    readonly kind: 'video' | 'audio';
    readonly media_type: string;
    readonly extension: 'mp4' | 'wav' | 'm4a' | 'mp3' | 'flac' | 'ogg';
    readonly duration_frames: number;
    readonly duration_ms: number;
    readonly width: number | null;
    readonly height: number | null;
    readonly sample_rate: number | null;
    readonly channels: number | null;
    readonly codec: string;
}
export interface LocalMediaToolOptions {
    readonly signal?: AbortSignal;
    /** Host-only test/operation policy, never a field in an Agent DTO. */
    readonly timeoutMs?: number;
    readonly onSpawn?: (pid: number) => void;
}
/** Resolve/reject only after the exact child's close; abort and deadline do not orphan tools. */
export async function runLocalMediaTool(command: 'ffprobe' | 'ffmpeg', args: string[], options: LocalMediaToolOptions = {}): Promise<{
    stdout: string;
    stderr: string;
}> {
    const { signal } = options, timeout = options.timeoutMs ?? 120000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000)
        throw new ProductError('CAPABILITY_UNAVAILABLE', 'Invalid local inspection deadline');
    if (signal?.aborted)
        throw new ProductError('CAPABILITY_UNAVAILABLE', 'Media inspection was cancelled');
    return new Promise((resolve, reject) => {
        const child = spawn(command, localMediaArgs(command, ['-format_whitelist', 'mov,wav,mp3,flac,ogg', ...args]), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        const stdout: Buffer[] = [], stderr: Buffer[] = [];
        let count = 0, spawnError: unknown, reason: 'cancelled' | 'timeout' | 'output_limit' | 'observer_failed' | null = null, closed = false;
        const kill = () => { if (!closed && child.exitCode === null && child.signalCode === null)
            child.kill('SIGKILL'); };
        const abort = () => { reason ??= 'cancelled'; kill(); };
        const timer = setTimeout(() => { reason ??= 'timeout'; kill(); }, timeout);
        timer.unref();
        const collect = (destination: Buffer[], chunk: Buffer) => {
            if (reason)
                return;
            count += chunk.length;
            if (count > 4 * 1024 * 1024) {
                reason = 'output_limit';
                kill();
                return;
            }
            destination.push(chunk);
        };
        child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
        child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
        child.on('spawn', () => { if (options.onSpawn)
            try {
                options.onSpawn(child.pid!);
            }
            catch {
                reason ??= 'observer_failed';
                kill();
            } });
        child.on('error', error => { spawnError = error; kill(); });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted)
            abort();
        child.once('close', (code, exitSignal) => {
            closed = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (reason) {
                reject(new ProductError('CAPABILITY_UNAVAILABLE', reason === 'cancelled' ? 'Media inspection was cancelled' : reason === 'timeout' ? 'Media inspection exceeded its deadline' : 'Media inspection could not complete'));
                return;
            }
            if (spawnError) {
                reject(asHostResourceError(spawnError) ? new ProductError('HOST_RESOURCE_EXHAUSTED', 'Local media inspection could not complete') : new ProductError('CAPABILITY_UNAVAILABLE', 'Local media inspection tools are unavailable'));
                return;
            }
            if (exitSignal) {
                reject(new ProductError('CAPABILITY_UNAVAILABLE', 'Local media inspection was interrupted'));
                return;
            }
            if (code !== 0) {
                reject(new ProductError('INVALID_REQUEST', 'The local media could not be fully probed or decoded'));
                return;
            }
            resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
        });
    });
}
/** Fixed local demuxer/protocol allowlists; no shell, provider, URL or command supplied by clients. */
export async function probeLocalMedia(path: string, kind: 'video' | 'audio', sha256: string, fps: {
    num: number;
    den: number;
}, signal?: AbortSignal, onToolSpawn?: (event: {
    readonly command: 'ffprobe' | 'ffmpeg';
    readonly pid: number;
}) => void): Promise<LocalMediaFacts> {
    const tool = (command: 'ffprobe' | 'ffmpeg', args: string[], signal?: AbortSignal) => runLocalMediaTool(command, args, { ...(signal ? { signal } : {}), ...(onToolSpawn ? { onSpawn: (pid: number) => onToolSpawn({ command, pid }) } : {}) });
    const rate = fps.num / fps.den;
    if (kind === 'video') {
        let result: Awaited<ReturnType<typeof validateImportedMedia>>, codec: string | undefined, executeFailure: unknown;
        try {
            result = await validateImportedMedia(path, rate, sha256, { ...(signal ? { signal } : {}), execute: async (command, args, options) => {
                    try {
                        const actual = [...args];
                        if (command === 'ffprobe') {
                            const at = actual.indexOf('-show_entries');
                            if (at >= 0)
                                actual[at + 1] += ",codec_name";
                        }
                        const output = await tool(command === 'ffprobe' ? 'ffprobe' : 'ffmpeg', actual, options.signal);
                        if (command === 'ffprobe') {
                            const streams = (JSON.parse(output.stdout) as {
                                streams?: Array<{
                                    codec_type?: string;
                                    codec_name?: string;
                                }>;
                            }).streams ?? [];
                            if (streams.some(stream => !['video', 'audio'].includes(String(stream.codec_type))))
                                throw new ProductError('CAPABILITY_UNAVAILABLE', 'This media stream combination is not supported');
                            codec = streams.find(stream => stream.codec_type === 'video')?.codec_name;
                        }
                        return output;
                    }
                    catch (error) {
                        executeFailure = error;
                        throw error;
                    }
                } });
        }
        catch (error) {
            if (executeFailure instanceof ProductError)
                throw executeFailure;
            if (error instanceof ProductError)
                throw error;
            if (asHostResourceError(error))
                throw new ProductError('HOST_RESOURCE_EXHAUSTED', 'Local video inspection could not complete');
            if (error && typeof error === 'object' && 'code' in error && error.code === 'INVALID_MEDIA')
                throw new ProductError('INVALID_REQUEST', 'The video does not satisfy the project media requirements');
            throw new ProductError('CAPABILITY_UNAVAILABLE', 'Local video inspection is unavailable');
        }
        if (!codec)
            throw new ProductError('INVALID_REQUEST', 'The video codec was not observed');
        const decoded = await tool('ffmpeg', ['-nostdin', '-hide_banner', '-nostats', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', path, '-map', '0:v', '-map', '0:a?', '-f', 'null', '-'], signal);
        if (decoded.stderr.trim())
            throw new ProductError('INVALID_REQUEST', 'The video or its audio stream failed strict decoding');
        const duration_ms = Math.ceil(result.durationFrames * fps.den * 1000 / fps.num);
        if (!Number.isSafeInteger(duration_ms) || duration_ms < 1)
            throw new ProductError('INVALID_REQUEST', 'Media duration cannot be represented');
        return { kind, media_type: 'video/mp4', extension: 'mp4', duration_frames: result.durationFrames, duration_ms, width: result.width, height: result.height, sample_rate: null, channels: null, codec };
    }
    const probe = await tool('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name:stream=codec_type,codec_name,sample_rate,channels,duration_ts,time_base', '-of', 'json', path], signal);
    let parsed: {
        format?: {
            format_name?: unknown;
        };
        streams?: Array<{
            codec_type?: unknown;
            codec_name?: unknown;
            sample_rate?: unknown;
            channels?: unknown;
            duration_ts?: unknown;
            time_base?: unknown;
        }>;
    };
    try {
        parsed = JSON.parse(probe.stdout) as typeof parsed;
    }
    catch {
        throw new ProductError('INVALID_REQUEST', 'Media tools returned malformed facts');
    }
    const streams = parsed.streams ?? [];
    if (streams.length !== 1 || streams[0]?.codec_type !== 'audio')
        throw new ProductError('INVALID_REQUEST', 'A narration asset must have exactly one audio stream and no video');
    const stream = streams[0]!, sampleRate = Number(stream.sample_rate), channels = Number(stream.channels), duration = Number(stream.duration_ts), timeBase = typeof stream.time_base === 'string' ? /^(\d+)\/(\d+)$/.exec(stream.time_base) : null;
    if (![sampleRate, channels, duration].every(n => Number.isSafeInteger(n) && n > 0) || !timeBase || !timeBase.slice(1).every(v => Number.isSafeInteger(Number(v)) && Number(v) > 0) || typeof stream.codec_name !== 'string')
        throw new ProductError('INVALID_REQUEST', 'The narration has no usable duration, sample rate or channel facts');
    const ceil = (numerator: bigint, denominator: bigint): number => {
        const value = (numerator + denominator - 1n) / denominator;
        if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER))
            throw new ProductError('INVALID_REQUEST', 'Narration duration exceeds the supported integer range');
        return Number(value);
    };
    const numerator = BigInt(duration) * BigInt(timeBase[1]!), denominator = BigInt(timeBase[2]!);
    const duration_ms = ceil(numerator * 1000n, denominator);
    const duration_frames = ceil(numerator * BigInt(fps.num), denominator * BigInt(fps.den));
    const formats = String(parsed.format?.format_name ?? '').split(',');
    const extension = formats.includes('wav') ? 'wav' : formats.includes('mov') ? 'm4a' : formats.includes('mp3') ? 'mp3' : formats.includes('flac') ? 'flac' : formats.includes('ogg') ? 'ogg' : null;
    if (!extension || duration_frames < 1)
        throw new ProductError('INVALID_REQUEST', 'Narration is not in a supported local audio container');
    const decoded = await tool('ffmpeg', ['-nostdin', '-hide_banner', '-nostats', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', path, '-map', '0:a:0', '-f', 'null', '-'], signal);
    if (decoded.stderr.trim())
        throw new ProductError('INVALID_REQUEST', 'The audio failed strict decoding');
    const media_type = ({ wav: 'audio/wav', m4a: 'audio/mp4', mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg' } as const)[extension];
    return { kind, media_type, extension, duration_frames, duration_ms, width: null, height: null, sample_rate: sampleRate, channels, codec: stream.codec_name };
}
