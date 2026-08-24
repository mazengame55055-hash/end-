process.on('uncaughtException', e => console.error('[CRASH]', e));
process.on('unhandledRejection', e => console.error('[CRASH]', e));
try {
    const zlib = require('zlib');
    if (typeof zlib.createZstdDecompress !== 'function') {
        zlib.createZstdDecompress = function () {
            const { PassThrough } = require('stream');
            const p = new PassThrough();
            process.nextTick(() => p.emit('error', new Error('zstd unsupported on Node22 - server sent unexpected encoding')));
            return p;
        };
        console.log('[PATCH] zlib.createZstdDecompress polyfilled');
    }
} catch (_) {}

const fs = require('fs');
const path = require('path');
try {
    const _fetch = globalThis.fetch;
    if (_fetch) {
        globalThis.fetch = function (u, o) {
            o = o || {};
            try {
                const h = new (globalThis.Headers || require('undici').Headers)(o.headers || {});
                h.set('accept-encoding', 'gzip, deflate');
                o.headers = h;
            } catch (_) {}
            return _fetch.call(globalThis, u, o);
        };
    }
} catch (_) {}
try {
    const _und = require('undici');
    if (_und && typeof _und.fetch === 'function' && !_und.__zstdPatched) {
        const _uf = _und.fetch.bind(_und);
        _und.fetch = function (u, o) {
            o = o || {};
            try {
                const h = new (_und.Headers || globalThis.Headers)(o.headers || {});
                h.set('accept-encoding', 'gzip, deflate');
                o.headers = h;
            } catch (_) {}
            return _uf(u, o);
        };
        _und.__zstdPatched = 1;
    }
} catch (_) {}
const { execSync, exec: execCb } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(execCb);
const { PassThrough } = require('stream');

const libavPath = path.join(__dirname, 'node_modules', '@dank074', 'discord-video-stream', 'dist', 'media', 'LibavDemuxer.js');
if (fs.existsSync(libavPath)) {
    let code = fs.readFileSync(libavPath, 'utf8');
    if (code.includes('const readFrame = pDebounce.promise') && !code.includes('let readFrame')) {
        code = code.replace(
            'async function demux(input, { format }) {',
            'async function demux(input, { format }) {\n    let readFrame;'
        );
        code = code.replace('const readFrame = pDebounce.promise', 'readFrame = pDebounce.promise');
        fs.writeFileSync(libavPath, code);
        console.log('Patched LibavDemuxer.js');
    }
}

const { Client } = require('discord.js-selfbot-v13');
if (typeof globalThis.navigator === 'undefined') {
    globalThis.navigator = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Node/20', hardwareConcurrency: 4, language: 'en-US', languages: ['en-US'], platform: 'Linux' };
}
let Streamer = null, playStream = null;
const streamModReady = import('@dank074/discord-video-stream').then(m => {
    Streamer = m.Streamer;
    const rawPlay = typeof m.playStream === 'function' ? m.playStream : null;
    const legacyPlay = typeof m.streamLivestreamVideo === 'function' ? m.streamLivestreamVideo : null;
    if (!rawPlay && !legacyPlay) throw new Error('no playable export found');
    playStream = function (input, streamerInst, opts) {
        const qopts = {};
        if (opts) {
            if (opts.width) qopts.width = opts.width;
            if (opts.height) qopts.height = opts.height;
            const fps = opts.frameRate || opts.fps;
            if (fps) qopts.frameRate = fps;
        }
        if (rawPlay && m.prepareStream) {
            let prepared;
            try {
                prepared = m.prepareStream(input, { noTranscoding: true, ...qopts });
                console.log('[MOD] passthrough mode (no re-encode)');
            } catch (e0) {
                console.log('[MOD] passthrough unavailable, transcoding:', String(e0 && e0.message || e0).slice(0, 100));
                const enc = m.Encoders.software({ x264: { preset: 'superfast' } });
                prepared = m.prepareStream(input, { encoder: enc, ...qopts, bitrateVideo: 2500, bitrateVideoMax: 4000, videoCodec: m.Utils.normalizeVideoCodec('H264') });
            }
            return Promise.resolve(rawPlay(prepared.output, streamerInst, qopts)).catch(e1 => {
                console.error('[MOD] play attempt failed, retrying with explicit encoder:', String(e1 && e1.message || e1).slice(0, 120));
                const enc = m.Encoders.software({ x264: { preset: 'superfast' } });
                const t = m.prepareStream(input, { encoder: enc, ...qopts, bitrateVideo: 2500, bitrateVideoMax: 4000, videoCodec: m.Utils.normalizeVideoCodec('H264') });
                return rawPlay(t.output, streamerInst, qopts);
            });
        }
        const sopts = { ...qopts };
        return Promise.resolve(streamerInst.createStream(sopts)).then(udp => legacyPlay(input, udp));
    };
}).catch(e => console.error('[MOD] stream lib load failed:', e.message));
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

let ffmpegPath = ffmpegStatic;
if (process.platform === 'linux') {
    try {
        const sysFfmpeg = execSync('which ffmpeg', { encoding: 'utf8' }).trim();
        if (sysFfmpeg) {
            ffmpegPath = sysFfmpeg;
            console.log('Using system ffmpeg:', ffmpegPath);
        }
    } catch (_) {
        console.log('No system ffmpeg, using ffmpeg-static');
    }
}

const client = new Client();
let streamer = null;

async function reply(msg, text) {
    try { await msg.reply(text); } catch (e) { console.log('[reply blocked]', e.message); }
}

const TOKEN = readEnvKey('TOKEN');
function readEnvKey(name) {
    if (process.env[name]) return process.env[name];
    try {
        const line = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
            .split('\n').find((l) => l.trim().startsWith(name + '='));
        return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
    } catch (_) { return ''; }
}
const TMDB_API_KEY = readEnvKey('TMDB_API_KEY');
const VIDKING_COLOR = readEnvKey('VIDKING_COLOR') || 'e50914';
let GUILD_ID = '1324034047613079574';
let VOICE_ID = '1538500580568203365';
const MAIN_OWNER = '820408813790167041';
let OWNER_IDS = [MAIN_OWNER];

const IPTV = {
    host: process.env.IPTV_HOST || 'http://ugeen.live',
    port: process.env.IPTV_PORT || '8080',
    user: process.env.IPTV_USER || 'Ugeen_VIP1pjmEs',
    pass: process.env.IPTV_PASS || 'v0CvBh',
};

const M3U_URL = `${IPTV.host}:${IPTV.port}/get.php?username=${IPTV.user}&password=${IPTV.pass}&type=m3u_plus&output=ts`;

const QUALITY_PRESETS = {
    '240p':  { width: 426,  height: 240,  fps: 15,  bitrate: '400k',   maxrate: '500k',   bufsize: '1000k' },
    '360p':  { width: 640,  height: 360,  fps: 24,  bitrate: '800k',   maxrate: '1000k',  bufsize: '2000k' },
    '480p':  { width: 854,  height: 480,  fps: 30,  bitrate: '1500k',  maxrate: '2000k',  bufsize: '4000k' },
    '720p':  { width: 1280, height: 720,  fps: 30,  bitrate: '4500k',  maxrate: '5500k',  bufsize: '11000k' },
    '720pf': { width: 1280, height: 720,  fps: 25,  bitrate: '3500k',  maxrate: '4500k',  bufsize: '9000k' },
    '1080p': { width: 1920, height: 1080, fps: 30,  bitrate: '8000k',  maxrate: '10000k', bufsize: '20000k' },
    '1440p': { width: 2560, height: 1440, fps: 30,  bitrate: '15000k', maxrate: '18000k', bufsize: '36000k' },
    '4k':    { width: 3840, height: 2160, fps: 30,  bitrate: '25000k', maxrate: '30000k', bufsize: '60000k' },
    '8k':    { width: 7680, height: 4320, fps: 30,  bitrate: '50000k', maxrate: '60000k', bufsize: '120000k' },
};

let selectedQuality = QUALITY_PRESETS['1080p'];
let currentChannelName = null;
let abortController = null;
let channelsCache = null;
let isPlaying = false;
let ffmpegProcess = null;
let mediaBufferStream = null;
let isPaused = false;
let mediaInfo = null;
let pendingSeek = null;
let subDelayAdj = 0;
let seekOffset = 0;
let activePlayPromise = null;
let seekFails = 0;
let streamBytes = 0;
let lastProgressAt = 0;
let ffmpegStderrTail = '';
let wdLastBytes = 0;
let wdTrickleStreak = 0;
let wdKillStreak = 0;
let wdLastPos = 0;
let activeProvider = '';

const PROACTIVE_ROTATE_MS = 270000;
setInterval(() => {
    if (!isPlaying || isPaused || !ffmpegProcess) return;
    const now = Date.now();
    const runAge = mediaInfo && mediaInfo.runStartedAt ? now - mediaInfo.runStartedAt : 0;
    const delta = streamBytes - wdLastBytes;
    wdLastBytes = streamBytes;
    if (mediaInfo && !mediaInfo.live && !mediaInfo.paused && runAge > PROACTIVE_ROTATE_MS) {
        console.log('[Rotate] proactive source rotation (fresh URL) at ' + Math.round(runAge / 1000) + 's');
        console.log('[ffmpeg] stderr tail:\n' + ffmpegStderrTail.split('\n').slice(-5).join('\n'));
        lastProgressAt = now;
        killFFmpeg();
        return;
    }
    const starved = now - lastProgressAt > 12000;
    const trickling = runAge > 20000 && delta < 30000 && now - lastProgressAt < 12000;
    wdTrickleStreak = trickling ? wdTrickleStreak + 1 : 0;
    if (starved || (trickling && wdTrickleStreak >= 2)) {
        console.log(`[Watchdog] ${starved ? 'no data >12s' : 'trickling x' + wdTrickleStreak + ' (' + delta + 'B in 5s)'}, restarting`);
        wdTrickleStreak = 0;
        const pos = mediaInfo && !mediaInfo.live ? (mediaInfo.offsetBase || 0) + Math.max(0, (now - (mediaInfo.runStartedAt || now)) / 1000) : 0;
        if (pos - (wdLastPos || -999) < 60) wdKillStreak++; else wdKillStreak = 1;
        wdLastPos = pos;
        console.log(`[Watchdog] kill streak=${wdKillStreak} at ${Math.floor(pos)}s`);
        if (wdKillStreak >= 2 && activeProvider) { phBump(activeProvider); console.log(`[Watchdog] provider ${activeProvider} marked unhealthy`); }
        if (wdKillStreak >= 3) {
            console.log('[Watchdog] escalating: forcing source rotation');
            reconnectAttempts = MAX_RECONNECT;
        }
        console.log('[ffmpeg] stderr tail:\n' + ffmpegStderrTail.split('\n').slice(-8).join('\n'));
        lastProgressAt = now;
        wdLastBytes = streamBytes;
        killFFmpeg();
        return;
    }
    if (runAge > 30000 && delta >= 30000 && reconnectAttempts > 0) {
        reconnectAttempts = 0;
        wdKillStreak = 0;
        wdLastPos = 0;
        console.log('[YT] healthy playback, reconnect budget restored');
    }
}, 5000);
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;
const RECONNECT_DELAY = 4000;

function parseM3U(m3uText) {
    const channels = {};
    const lines = m3uText.split('\n');
    let index = 1;
    let currentName = null;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#EXTINF:')) {
            const nameMatch = trimmed.match(/tvg-name="([^"]*)"/) || trimmed.match(/,([^,]+)$/);
            if (nameMatch) {
                currentName = nameMatch[1].trim();
            }
        } else if (trimmed.startsWith('http') && currentName) {
            channels[String(index)] = { name: currentName, url: trimmed };
            index++;
            currentName = null;
        }
    }
    return channels;
}

async function fetchChannels() {
    try {
        const response = await fetch(M3U_URL);
        const text = await response.text();
        channelsCache = parseM3U(text);
        console.log(`Fetched ${Object.keys(channelsCache).length} channels`);
        return channelsCache;
    } catch (err) {
        console.error('Failed to fetch M3U:', err.message);
        if (channelsCache) return channelsCache;
        return null;
    }
}

const PAGE_SIZE = 30;

async function showChannelsPage(message, channels, page) {
    const entries = Object.entries(channels);
    const total = entries.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const validPage = Math.max(1, Math.min(page, totalPages));
    const start = (validPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageEntries = entries.slice(start, end);
    const list = pageEntries.map(([key, ch]) =>
        `\`${String(key).padStart(3)}\` ${ch.name}`
    ).join('\n');
    const channelList = [
        `📺 **قنوات IPTV** — الصفحة ${validPage}/${totalPages} (${total} قناة)`,
        '',
        list,
        '',
        validPage > 1 ? '🔹 `!tv ' + (validPage - 1) + '` → الصفحة السابقة' : '',
        validPage < totalPages ? '🔹 `!tv ' + (validPage + 1) + '` → الصفحة التالية' : '',
        '🔹 `!play <رقم>` للتشغيل',
        '🔹 `!stop` للإيقاف',
    ].filter(Boolean).join('\n');
    await reply(message, channelList);
}

function killFFmpeg() {
    if (ffmpegProcess) {
        try { ffmpegProcess.kill('SIGKILL'); } catch (_) {}
        ffmpegProcess = null;
    }
    if (mediaBufferStream) {
        try { mediaBufferStream.end(); } catch (_) {}
        mediaBufferStream = null;
    }
}

async function stopPlaying(message) {
    const name = currentChannelName || '';
    reconnectAttempts = MAX_RECONNECT;
    killFFmpeg();
    try { streamer.stopStream(); } catch (_) {}
    activePlayPromise = null;
    try { streamer.leaveVoice(); } catch (_) {}
    if (abortController) {
        try { abortController.abort(); } catch (_) {}
        abortController = null;
    }
    currentChannelName = null;
    isPlaying = false;
    isPaused = false;
    mediaInfo = null;
    pendingSeek = null;
    if (message) await reply(message, `🛑 تم إيقاف **${name}** ومغادرة الروم.`);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function joinVoiceSafe() {
    if (streamer.voiceConnection) return;
    const delays = [3000, 6000, 10000];
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await Promise.race([
                streamer.joinVoice(GUILD_ID, VOICE_ID),
                sleep(15000).then(() => { throw new Error('join timeout'); }),
            ]);
            console.log('[Voice] Joined voice channel');
            await sleep(700);
            return;
        } catch (e) {
            console.error(`[Voice] join failed (try ${attempt}/3): ${e.message}`);
            try { streamer.leaveVoice(); } catch (_) {}
            try { streamer.stopStream(); } catch (_) {}
            if (attempt < 3) await sleep(delays[attempt - 1]);
        }
    }
    throw new Error('تعذر الدخول لروم الصوت بعد عدة محاولات. جرّب !stop ثم أعد المحاولة.');
}

function buildFFmpegArgs(channelUrl, quality) {
    const { width, height, fps, bitrate, maxrate, bufsize } = quality;
    return [
        '-hide_banner', '-loglevel', 'warning',
        '-headers', 'User-Agent: VLC/3.0.20 LibVLC/3.0.20\r\n',
        '-timeout', '30000000',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-reconnect_at_eof', '1',
        '-reconnect_on_network_error', '1',
        '-rw_timeout', '10000000',
        '-analyzeduration', '2000000',
        '-probesize', '10000000',
        '-thread_queue_size', '8192',
        '-i', channelUrl,
        '-fflags', '+genpts+discardcorrupt+nobuffer',
        '-flags', '+low_delay+global_header',
        '-max_muxing_queue_size', '4096',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-profile:v', 'main',
        '-level', '4.1',
        '-ar', '48000',
        '-c:a', 'libopus',
        '-b:a', '128k',
        '-ac', '2',
        '-s', `${width}x${height}`,
        '-r', String(fps),
        '-b:v', bitrate,
        '-maxrate', maxrate,
        '-bufsize', bufsize,
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-row-mt', '1',
        '-threads', '4',
        '-f', 'mpegts',
        'pipe:1',
    ];
}

async function startStream(channel, message) {
    reconnectAttempts = 0;
    isPaused = false;
    mediaInfo = { title: channel.name, live: true, offsetBase: 0, runStartedAt: Date.now(), paused: false, pauseStartedAt: null };

    while (reconnectAttempts < MAX_RECONNECT) {
        if (!isPlaying) break;

        console.log(`[Stream] Starting: ${channel.name} (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT})`);

        try {
            if (!streamer.voiceConnection) {
                await streamer.joinVoice(GUILD_ID, VOICE_ID);
                console.log('[Stream] Joined voice channel');
                await sleep(700);
            }
            try { streamer.stopStream(); } catch (_) {}
            if (activePlayPromise) {
                await Promise.race([activePlayPromise.catch(() => {}), sleep(4000)]);
                activePlayPromise = null;
            }
            await sleep(300);
        } catch (e) {
            console.error('[Stream] Failed to join voice:', e.message);
            await reply(message, `❌ فشل دخول الروم الصوتي: ${e.message}`);
            isPlaying = false;
            return;
        }

        try {
            await new Promise((resolve, reject) => {
                const args = buildFFmpegArgs(channel.url, selectedQuality);

                if (fs.existsSync(ffmpegPath)) {
                    try { fs.chmodSync(ffmpegPath, 0o777); } catch (_) {}
                }

                ffmpegProcess = spawn(ffmpegPath, args, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                });

                let stderrLog = '';
                ffmpegProcess.stderr.on('data', (chunk) => {
                    stderrLog += chunk.toString();
                });

                ffmpegProcess.stdout.on('error', () => {});
                ffmpegProcess.on('error', (err) => {
                    console.error('[FFmpeg] Error:', err.message);
                    reject(err);
                });

                ffmpegProcess.on('exit', (code, signal) => {
                    ffmpegProcess = null;
                    if (code !== 0 && code !== null && signal !== 'SIGKILL') {
                        const last = stderrLog.split('\n').slice(-5).join('\n');
                        console.error(`[FFmpeg] Exit code=${code} signal=${signal}:\n${last}`);
                        reject(new Error(`FFmpeg exited with code ${code}`));
                    } else {
                        console.log(`[FFmpeg] Exit code=${code} signal=${signal}`);
                        resolve();
                    }
                });

                abortController = new AbortController();
                abortController.signal.addEventListener('abort', () => {
                    killFFmpeg();
                    resolve();
                });

                const bufferStream = new PassThrough({ highWaterMark: 1024 * 1024 * 2 });
                bufferStream.on('error', () => {});
                streamBytes = 0;
                lastProgressAt = Date.now();
                bufferStream.on('data', (d) => { streamBytes += d.length; lastProgressAt = Date.now(); });
                ffmpegProcess.stdout.pipe(bufferStream);
                mediaBufferStream = bufferStream;
                if (mediaInfo) { mediaInfo.runStartedAt = Date.now(); }

                activePlayPromise = playStream(bufferStream, streamer, {
                    type: 'go-live',
                    format: 'mpegts',
                    width: selectedQuality.width,
                    height: selectedQuality.height,
                    frameRate: selectedQuality.fps,
                }).then(() => {
                    console.log('[Stream] playStream finished');
                    resolve();
                }).catch((err) => {
                    console.error('[Stream] playStream error:', err.message);
                    reject(err);
                });
            });
        } catch (err) {
            console.error(`[Stream] Error: ${err.message}`);
        }

        killFFmpeg();

        if (!isPlaying) break;

        reconnectAttempts++;
        if (reconnectAttempts < MAX_RECONNECT) {
            console.log(`[Stream] Reconnecting in ${RECONNECT_DELAY / 1000}s... (${reconnectAttempts}/${MAX_RECONNECT})`);
            await sleep(RECONNECT_DELAY);
        }
    }

    isPlaying = false;
    currentChannelName = null;
    mediaBufferStream = null;
    isPaused = false;
    mediaInfo = null;
    killFFmpeg();
    try { streamer.stopStream(); } catch (_) {}
    try { streamer.leaveVoice(); } catch (_) {}
    if (reconnectAttempts >= MAX_RECONNECT) {
        await reply(message, `⚠️ **${channel.name}** تم الإيقاف بعد ${MAX_RECONNECT} محاولات.`);
    } else {
        await reply(message, `🛑 **${channel.name}** تم الإيقاف.`);
    }
}

const YTDLP_PATH = '/home/master/.local/bin/yt-dlp';
const COOKIES_PATH = '/home/master/end-/cookies.txt';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

async function tmdbSearch(type, query) {
    const u = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&language=ar&include_adult=false`;
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`tmdb http ${r.status}`);
    const j = await r.json();
    const out = j.results || [];
    const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const qn = norm(query);
    const score = (x) => {
        const t = norm(x.title || x.name);
        let s = (x.popularity || 0) / 100 + Math.min((x.vote_count || 0), 20000) / 400;
        if (qn && t === qn) s += 1e9;
        else if (qn && t.startsWith(qn)) s += 1e6;
        else if (qn && t.includes(qn)) s += 1e4;
        return s;
    };
    out.sort((a, b) => score(b) - score(a));
    return out;
}

function vkMovieUrl(id) {
    return `${VL_BASE}/movie/${id}?autoplay=true&player=jw`;
}

function vkTvUrl(id, s, e) {
    return `${VL_BASE}/tv/${id}/${s}/${e}?autoplay=true&player=jw&nextbutton=true`;
}

function fmtTmdbLine(x) {
    const t = x.title || x.name || '?';
    const y = (x.release_date || x.first_air_date || '').slice(0, 4);
    const r = x.vote_average ? `⭐${x.vote_average.toFixed(1)}` : '';
    return `**${t}** ${y ? `(${y})` : ''} ${r} \`${x.id}\``;
}

// ===== Vidking stream extraction =====
const VK_API = 'https://api.speedracelight.com';
const vkDecrypt = (function () {
    const Ys = [109, 118, 109, 49];
    const ms = 2654435769, Js = 61, Sf = 8;
    const Hl = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580];
    const _f = [0];
    function If(l) { return (l * (l + 1) & 1) === 1; }
    function wf(l) { const o = new Array(256); for (let i = 0; i < 256; i++) o[i] = i; let e = 0; for (let i = 0; i < 256; i++) { e = e + o[i] + l.charCodeAt(i % l.length) & 255; const r = o[i]; o[i] = o[e], o[e] = r } return o }
    function Af(l) { let o = _f[0] >>> 0; for (let e = 0; e < l.length; e++) o = ps((o ^ Math.imul(l.charCodeAt(e), Hl[e & 15])) >>> 0, 5); return ci(o) }
    function ci(l) { return l >>>= 0, l ^= l >>> 16, l = Math.imul(l, 2246822507) >>> 0, l ^= l >>> 13, l = Math.imul(l, 3266489909) >>> 0, l ^= l >>> 16, l >>> 0 }
    function vf(l) { let o = 2166136261; for (let e = 0; e < l.length; e++) o = Math.imul(o ^ l.charCodeAt(e), 16777619) >>> 0; return ci(o) }
    function ps(l, o) { return l >>>= 0, o &= 31, o === 0 ? l >>> 0 : (l << o | l >>> 32 - o) >>> 0 }
    const bf = l => (l * (l + 1) & 1) === 0;
    function Nf(l, o, e) { return ((l ^ o) >>> 0 | (l & o & e) >>> 0) >>> 0 }
    function Rf(l, o) { if (If(l.length)) return { S: wf(l), acc: Af(l) }; const e = new Array(Js); let i = ci(vf(l) ^ ci(o >>> 0 ^ ms)) >>> 0; for (let r = 0; r < Sf; r++) if (bf(r)) { const n = i % Js; i = ps(i + ms >>> 0, 7 + (r & 7)), e[n] = (i ^ ci(i)) >>> 0, i = ci(i + n >>> 0) } else e[r] = Hl[r & 15]; return { S: e, acc: ci(i ^ 2779096485) >>> 0 } }
    function Cf(l, o) { const e = l.S; let i = l.acc; const r = i % Js, n = 0 - +(r in e), u = e[r] >>> 0, d = Math.imul(ms, o + 1) >>> 0; let g = Nf(i, (u ^ d) >>> 0, n); return g = (ps(g + i >>> 0, r & 31) ^ ps(i, Math.imul(r, 7) & 31)) >>> 0, i = ci(g + ms >>> 0), e[r] = i >>> 0, l.acc = i, i >>> 0 }
    function xf(l, o, e) { const i = Rf(l, o), r = new Uint8Array(e); let n = 0; for (let u = 0; u < e;) { const d = Cf(i, n++); r[u++] = d & 255, u < e && (r[u++] = d >>> 8 & 255), u < e && (r[u++] = d >>> 16 & 255), u < e && (r[u++] = d >>> 24 & 255) } return r }
    function Df(l) { const o = l.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(l.length / 4) * 4, '='), e = atob(o), i = new Uint8Array(e.length); for (let r = 0; r < e.length; r++) i[r] = e.charCodeAt(r); return i }
    function Pf(l, o, e) { const i = Df(l), r = xf(o, e, i.length); for (let n = 0; n < i.length; n++) i[n] ^= r[n]; for (let n = 0; n < Ys.length; n++) if (i[n] !== Ys[n]) throw new Error('decrypt failed'); return new TextDecoder('utf-8').decode(i.subarray(Ys.length)) }
    return Pf;
})();

async function vkGetSeed(tmdbId) {
    const r = await fetch(`${VK_API}/seed?mediaId=${encodeURIComponent(String(tmdbId))}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('seed http ' + r.status);
    return r.json();
}

async function vkSources(type, tmdbId, season, episode) {
    const metaR = await fetch(`https://db.speedracelight.com/3/${type}/${tmdbId}?append_to_response=external_ids`, { signal: AbortSignal.timeout(15000) });
    if (!metaR.ok) throw new Error('meta http ' + metaR.status);
    const meta = await metaR.json();
    const title = meta.title || meta.name || '';
    const year = String((meta.release_date || meta.first_air_date || '').slice(0, 4));
    const imdbId = (meta.external_ids && meta.external_ids.imdb_id) || '';

    const { seed } = await vkGetSeed(tmdbId);

    const servers = [
        { name: 'Yoru', endpoint: 'cdn/sources-with-title' },
        { name: 'Breach', endpoint: 'm4uhd/sources-with-title' },
        { name: 'Omen', endpoint: 'lamovie/sources-with-title' },
        { name: 'Killjoy', endpoint: 'meine/sources-with-title', params: { language: 'german' } },
        { name: 'Cypher', endpoint: 'downloader2/sources-with-title' },
        { name: 'Neon', endpoint: 'vsrc/sources-with-title' },
        { name: 'Raze', endpoint: 'superflix/sources-with-title' },
    ];

    const found = [];
    for (const srv of servers) {
        try {
            const E = new URL(`${VK_API}/${srv.endpoint}`);
            E.searchParams.append('title', title);
            E.searchParams.append('mediaType', type);
            E.searchParams.append('year', year);
            E.searchParams.append('episodeId', String(episode || '1'));
            E.searchParams.append('seasonId', String(season || '1'));
            E.searchParams.append('tmdbId', String(tmdbId));
            E.searchParams.append('imdbId', imdbId);
            E.searchParams.append('enc', '2');
            E.searchParams.append('seed', seed);
            if (srv.params) for (const [k, v] of Object.entries(srv.params)) E.searchParams.append(k, v);
            const r = await fetch(E.toString(), {
                headers: {
                    Referer: 'https://www.vidking.net/',
                    Origin: 'https://www.vidking.net',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
                    Accept: '*/*',
                },
                signal: AbortSignal.timeout(20000),
            });
            if (!r.ok) continue;
            const data = JSON.parse(vkDecrypt(await r.text(), seed, parseInt(tmdbId)));
            const arr = Array.isArray(data && data.sources) ? data.sources : [];
            for (const q of arr) {
                if (q && typeof q.url === 'string' && /^https?:\/\/.+\.m3u8/.test(q.url)) {
                    found.push({ url: q.url, quality: q.quality || 'auto', server: srv.name });
                }
            }
            if (found.length >= 2 && new Set(found.map((f) => f.server)).size >= 2) break;
        } catch (_) { /* try next server */ }
    }
    return { title, year, sources: found };
}

function vkPickBest(sources, prefQuality, returnList) {
    const base = (q) => /1080/.test(q.quality) ? 4 : /720/.test(q.quality) ? 3 : /auto|hls/i.test(q.quality) ? 2 : /480|360/.test(q.quality) ? 1 : 0;
    const score = (q) => (prefQuality && new RegExp(prefQuality).test(q.quality) ? base(q) + 10 : base(q));
    const sorted = [...sources].sort((a, b) => score(b) - score(a));
    return returnList ? sorted : (sorted[0] || null);
}

// ===== VidLink stream extraction =====
const VL_BASE = 'https://vidlink.pro';
let vlReadyPromise = null;
let vlSodium = null;
function vlInit() {
    if (!vlReadyPromise) {
        vlReadyPromise = (async () => {
            const sodium = require('libsodium-wrappers-sumo');
            await sodium.ready;
            vlSodium = sodium;
            globalThis.sodium = sodium;
            require('./vl_go.js');
            const wasmBytes = fs.readFileSync(path.join(__dirname, 'fu.wasm'));
            const d = new globalThis.Dm();
            const { instance } = await WebAssembly.instantiate(wasmBytes, d.importObject);
            await Promise.race([d.run(instance), sleep(10000)]);
            if (typeof globalThis.getAdv !== 'function') throw new Error('getAdv unavailable');
            return true;
        })().catch((e) => { vlReadyPromise = null; throw e; });
    }
    return vlReadyPromise;
}

let vlUndici = null;
function vlGetUndici() {
    if (vlUndici === null) {
        try { vlUndici = require('undici'); } catch (_) { vlUndici = false; }
    }
    return vlUndici || null;
}

async function vlApiFetch(url, headers) {
    const U = vlGetUndici();
    if (U && U.fetch && U.Agent) {
        const agent = new U.Agent({ keepAliveTimeout: 10, keepAliveMaxTimeout: 100 });
        try {
            return await U.fetch(url, { headers, dispatcher: agent, signal: AbortSignal.timeout(20000) });
        } finally { try { await agent.close(); } catch (_) {} }
    }
    return fetch(url, { headers, signal: AbortSignal.timeout(20000) });
}

async function vlSources(type, tmdbId, season, episode) {
    await vlInit();
    globalThis.sodium = vlSodium;
    const adv = globalThis.getAdv(String(tmdbId));
    if (!adv) { console.log(`[VL] getAdv returned null for ${tmdbId}`); return null; }
    const apiUrl = type === 'movie'
        ? `${VL_BASE}/api/b/movie/${adv}?multiLang=0`
        : `${VL_BASE}/api/b/tv/${adv}/${season || 1}/${episode || 1}?multiLang=0`;
    const r = await vlApiFetch(apiUrl, { 'X-Playback-Environment': 'default', Referer: `${VL_BASE}/` });
    if (!r.ok) { console.log(`[VL] api http ${r.status} for ${type} ${tmdbId}`); return null; }
    const txt = await r.text();
    if (!txt || txt === 'null') { console.log(`[VL] api empty for ${type} ${tmdbId}`); return null; }
    const j = JSON.parse(txt);
    const st = j && j.stream;
    if (!st) { console.log(`[VL] no stream obj for ${type} ${tmdbId}: ${txt.slice(0, 80)}`); return null; }

    let title = '', year = '';
    try {
        const mr = await fetch(`https://api.themoviedb.org/3/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}?api_key=${TMDB_API_KEY}&language=ar`, { signal: AbortSignal.timeout(15000) });
        if (mr.ok) {
            const m = await mr.json();
            title = m.title || m.name || '';
            year = String((m.release_date || m.first_air_date || '').slice(0, 4));
        }
    } catch (_) {}

    const out = [];
    const vlDefHdrs = () => ({ 'user-agent': CC_UA, referer: `${VL_BASE}/` });
    if (typeof st.playlist === 'string') {
        out.push({ url: st.playlist, quality: 'hls', server: 'VidLink', headers: { ...vlDefHdrs(), ...(st.playlistHeaders || {}) } });
    }
    if (st.qualities && typeof st.qualities === 'object') {
        const order = ['1080', '720', '480', '360'];
        const keys = Object.keys(st.qualities).sort((a, b) => {
            const ia = order.indexOf(a), ib = order.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        for (const k of keys) {
            const q = st.qualities[k];
            if (!q || typeof q.url !== 'string') continue;
            const apiH = (q.headers && typeof q.headers === 'object') ? q.headers : {};
            const hdrs = { ...vlDefHdrs(), ...apiH };
            out.push({ url: q.url, quality: String(k), server: 'VidLink', headers: hdrs });
        }
    }
    if (!out.length) return null;

    let subUrl = null;
    const caps = Array.isArray(st.captions) ? st.captions : [];
    const stripTashkeel = (t) => String(t || '').replace(/[\u064B-\u0652\u0670\u0640]/g, '');
    const arCap = caps.find((x) => x && x.url && /عرب|arab/i.test(stripTashkeel(x.language))) || caps.find((x) => x && /^ar\b/i.test(stripTashkeel(x.language)));
    if (arCap && arCap.type === 'srt') subUrl = arCap.url;

    return { title, year, sources: out, subUrl };
}

async function vlFetchArabicSub(subUrl) {
    try {
        const r = await fetch(subUrl, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) return null;
        let buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 10 || !buf.toString('utf8').includes('-->')) return null;
        let cleaned = buf.toString('utf8')
            .normalize('NFKC')
            .replace(/[\u202A-\u202E\u200E\u200F\u2066-\u2069\u200B-\u200D\u00AD\u2060]/g, '')
            .replace(/\uFEFF/g, '')
            .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{2500}-\u{25FF}]/gu, '')
            .replace(/\[\s*\]/g, '')
            .replace(/\[([^\]\n]{1,80})\]/g, '($1)')
            .replace(/[\[\]]/g, '')
            .replace(/\{\\[^{}]*\}/g, '')
            .replace(/[{}]/g, '')
            .replace(/\r\n/g, '\n');
        const isVtt = /^WEBVTT/i.test(cleaned.trim()) || /\.vtt(\?|$)/i.test(subUrl);
        const spamRe = /hoofoot|opensubtitles\.org|facebook\.com|instagram\.com|t\.me\/|telegram|subtitle.*by|synced.*by|ترجمة|تعريب|ترجمت/gi;
        if (isVtt) {
            const normTs = (t) => {
                t = String(t || '').trim();
                const p = t.split(':');
                if (p.length === 2) p.unshift('00');
                if (p.length !== 3) return '';
                return `${p[0].padStart(2, '0')}:${p[1].padStart(2, '0')}:${p[2].replace('.', ',').padStart(6, '0')}`;
            };
            cleaned = cleaned.replace(/^WEBVTT[^\n]*\n?/, '');
            const blocks = cleaned.split(/\n{2,}/);
            const out = [];
            let n = 0;
            for (const b of blocks) {
                const ls = b.split('\n');
                const ti = ls.findIndex((l) => l.includes('-->'));
                if (ti === -1) continue;
                const sides = ls[ti].split('-->');
                if (sides.length !== 2) continue;
                const st = normTs(sides[0]);
                const en = normTs(sides[1]);
                const textLines = ls.slice(ti + 1)
                    .map((l) => {
                        let t = l.replace(/<[^>]+>/g, '').replace(/\\N|\\n/g, ' ').trim();
                        const mLead = t.match(/^([.!؟,،])\s*(.+)$/s);
                        if (mLead && mLead[2].trim()) t = mLead[2].trim() + mLead[1];
                        return t;
                    })
                    .filter(Boolean);
                if (!textLines.length || !st || !en) continue;
                if (textLines.every((l) => spamRe.test(l))) { spamRe.lastIndex = 0; continue; }
                spamRe.lastIndex = 0;
                n++;
                out.push(`${n}\n${st} --> ${en}\n${textLines.join('\n')}`);
            }
            if (!out.length) return null;
            cleaned = out.join('\n\n') + '\n';
        }
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim() + '\n';
        buf = Buffer.from(cleaned, 'utf8');
        const p = `/tmp/vlsub_${process.pid}_${Date.now()}.srt`;
        fs.writeFileSync(p, buf);
        console.log(`[VL] arabic subs saved: ${p} (${buf.length} bytes${isVtt ? ', vtt->srt' : ''})`);
        return p;
    } catch (_) { return null; }
}

async function stSources(type, id, s, e) {
    try {
        const api = type === 'movie'
            ? `https://api.shows.st/movie?id=${id}&mode=json&srv=moviebox`
            : `https://api.shows.st/tv?id=${id}&season=${s || 1}&episode=${e || 1}&mode=json&srv=moviebox`;
        const txt = await ccFetch(api);
        const j = JSON.parse(txt);
        if (!j.source || !j.source.url) { console.log('[ST] no source'); return null; }
        let subUrl = null;
        if (Array.isArray(j.subtitles)) {
            const ar = j.subtitles.find(x => x && x.file && (/^arabic(\b|\d)/i.test(x.label || '') || /\/Arabic[^\/]*\.vtt$/i.test(x.file)));
            if (ar) subUrl = ar.file;
        }
        const meta = j.meta || {};
        console.log(`[ST] ok (${type})${subUrl ? ' +arabic-sub' : ''}`);
        return {
            title: meta.title || meta.name || '',
            year: meta.release_date ? String(meta.release_date).slice(0, 4) : '',
            sources: [{ url: j.source.url, quality: '720', server: '111movies', extPicky: true }],
            subUrl,
        };
    } catch (err) {
        console.error('[ST] sources error:', err.message);
        return null;
    }
}

function vlCleanupSub(p) {
    if (p) { try { fs.unlinkSync(p); } catch (_) {} }
}

const CC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

async function ccFetch(url, referer) {
    const U = vlGetUndici();
    const hdrs = { 'user-agent': CC_UA, ...(referer ? { referer } : {}) };
    if (U && U.fetch && U.Agent) {
        const agent = new U.Agent({ keepAliveTimeout: 10, keepAliveMaxTimeout: 100 });
        try {
            return await (await U.fetch(url, { headers: hdrs, dispatcher: agent, signal: AbortSignal.timeout(20000) })).text();
        } finally { try { await agent.close(); } catch (_) {} }
    }
    return fetch(url, { headers: hdrs, signal: AbortSignal.timeout(20000) }).then(r => r.text());
}

const VN_ALPHA = 'RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=';
function vnDecrypt(data) {
    const map = {};
    [...VN_ALPHA].forEach((c, i) => { map[c] = i; });
    let s = String(data || '');
    while (s.length % 4) s += '=';
    const out = [];
    for (let i = 0; i < s.length; i += 4) {
        const l = [0, 1, 2, 3].map(j => (map[s[i + j]] !== undefined ? map[s[i + j]] : 64));
        out.push((l[0] << 2) | (l[1] >> 4));
        if (l[2] !== 64) out.push(((l[1] & 15) << 4) | (l[2] >> 2));
        if (l[3] !== 64) out.push(((l[2] & 3) << 6) | l[3]);
    }
    const str = Buffer.from(out).toString('utf8');
    try { return JSON.parse(str); } catch (_) { return {}; }
}

const VN_EPS = ['hollymoviehd', 'videasy', 'rogflix', 'vidzee', 'nextgencloudfabric', 'buzz', 'allmovies'];
async function ccSources(type, id, s, e) {
    for (const ep of VN_EPS) {
        try {
            const api = type === 'movie'
                ? `https://new.vidnest.fun/${ep}/movie/${id}`
                : `https://new.vidnest.fun/${ep}/tv/${id}/${s || 1}/${e || 1}`;
            const txt = await ccFetch(api, 'https://cineby.hair/');
            const j = JSON.parse(txt);
            const dec = j.encrypted ? vnDecrypt(j.data) : j;
            const streams = dec.streams || dec.sources || [];
            const good = (Array.isArray(streams) ? streams : []).filter(x => x && x.url);
            if (!good.length) continue;
            const out = good.map(x => ({
                url: x.url,
                quality: x.quality || '720',
                server: '2Embed',
                ...(x.type === 'hls' ? { extPicky: true } : {}),
                ...(x.headers && Object.keys(x.headers).length ? { headers: x.headers } : {}),
            }));
            console.log(`[CC] ${ep}: ${out.length} sources`);
            return { title: '', year: '', sources: out, subUrl: null };
        } catch (_) {}
    }
    console.log('[CC] all endpoints failed');
    return null;
}

let _mgCache = { key: '', t: 0, out: null };
async function mgSources(type, id, s, e) {
    const key = `${type}/${id}/${s || 1}/${e || 1}`;
    if (_mgCache.key === key && _mgCache.out && Date.now() - _mgCache.t < 8 * 60000) {
        return { title: '', year: '', sources: _mgCache.out, subUrl: null };
    }
    try {
        const path = type === 'movie'
            ? `embed/movie/${id}`
            : `embed/tv/${id}/${s || 1}/${e || 1}`;
        const html = await ccFetch(`https://megaembed.com/${path}`);
        if (!html) throw new Error('empty page');
        const files = [];
        const re = /"file":"([^"]+?)"/g;
        let m;
        while ((m = re.exec(html)) !== null) files.push(m[1]);
        const uniq = [...new Set(files)];
        const mp4 = uniq.filter(u => /\.mp4(\?|$)/i.test(u));
        const hls = uniq.filter(u => /hls\.php|\.m3u8/i.test(u));
        const ordered = [...mp4, ...hls];
        if (!ordered.length) { console.log('[MG] no sources in page'); return null; }
        const out = ordered.map((u, i) => ({
            url: u,
            quality: '720',
            server: `MG-${i + 1}`,
            ...(/\.m3u8|hls\.php/i.test(u) ? { extPicky: true } : {}),
        }));
        _mgCache = { key, t: Date.now(), out };
        console.log(`[MG] ok: ${out.length} sources (${mp4.length} mp4 direct)`);
        return { title: '', year: '', sources: out, subUrl: null };
    } catch (err) {
        console.error('[MG] sources error:', err.message);
        return null;
    }
}

const TR_DIR_PREFIX = '/tmp/trdl_';
let trActiveProc = null;
let lastSeriesCtx = null;
function trKill() {
    try { if (trActiveProc) { trActiveProc.kill('SIGKILL'); trActiveProc = null; } } catch (_) {}
    try {
        for (const f of fs.readdirSync('/tmp')) {
            if (f.startsWith('trdl_')) { try { fs.rmSync(path.join('/tmp', f), { recursive: true, force: true }); } catch (_) {} }
        }
    } catch (_) {}
}
async function trSources(type, tmdbId, season, episode) {
    try {
        let title = '';
        let tyear = '';
        try {
            const mr = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}`, { signal: AbortSignal.timeout(15000) });
            const mj = await mr.json();
            title = mj.title || mj.name || '';
            tyear = String((type === 'movie' ? mj.release_date : mj.first_air_date) || '').slice(0, 4);
        } catch (_) {}
        if (!title && type !== 'tv') return null;
        let mg = null;
        if (type === 'movie') {
            const hits = [];
            try {
                const yr = await fetch(`https://apibay.org/q.php?q=${encodeURIComponent(title.trim())}`, { signal: AbortSignal.timeout(15000) });
                const arr = await yr.json();
                if (Array.isArray(arr)) for (const t of arr) {
                    if (!t || !t.info_hash || /^0{40}$/.test(t.info_hash)) continue;
                    const seeds = parseInt(t.seeders || '0', 10);
                    if (seeds <= 5) continue;
                    const szn = parseInt(t.size || '0', 10);
                    if (szn && szn < 600 * 1024 * 1024) continue;
                    const nm = String(t.name || '');
                    const isCam = /\b(cam|ts|hdcam|screener)\b/i.test(nm);
                    if (isCam) continue;
                    const quality = /2160p/i.test(nm) ? '2160p' : /1080p/i.test(nm) ? '1080p' : /720p/i.test(nm) ? '720p' : null;
                    if (!quality) continue;
                    hits.push({ hash: t.info_hash.toLowerCase(), quality, seeds, name: nm });
                }
            } catch (_) {}
            if (!hits.length && tyear) {
                try {
                    const yr2 = await fetch(`https://apibay.org/q.php?q=${encodeURIComponent(`${title.trim()} ${tyear}`)}`, { signal: AbortSignal.timeout(15000) });
                    const arr2 = await yr2.json();
                    if (Array.isArray(arr2)) for (const t of arr2) {
                        if (!t || !t.info_hash || /^0{40}$/.test(t.info_hash)) continue;
                        const seeds = parseInt(t.seeders || '0', 10);
                        if (seeds <= 5) continue;
                        const nm = String(t.name || '');
                        if (/\b(cam|ts|hdcam|screener)\b/i.test(nm)) continue;
                        const quality = /2160p/i.test(nm) ? '2160p' : /1080p/i.test(nm) ? '1080p' : /720p/i.test(nm) ? '720p' : null;
                        if (!quality) continue;
                        hits.push({ hash: t.info_hash.toLowerCase(), quality, seeds, name: nm });
                    }
                } catch (_) {}
            }
            hits.sort((a, b) => ((b.quality === '1080p') - (a.quality === '1080p')) || (b.seeds - a.seeds));
            mg = hits[0] || null;
        } else {
            try {
                const er = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`, { signal: AbortSignal.timeout(15000) });
                const ej = await er.json();
                const imdb = (((ej.external_ids || {}).imdb_id) || '').replace(/^tt/, '');
                if (!imdb) return null;
                if (!title) title = ej.name || 'series';
                const zr = await fetch(`https://eztvx.to/api/get-torrents?imdb_id=${imdb}&limit=100`, { signal: AbortSignal.timeout(15000) });
                const arr = (((await zr.json()) || {}).torrents) || [];
                const want = `s${String(season || 1).padStart(2, '0')}e${String(episode || 1).padStart(2, '0')}`;
                const cands = [];
                for (const t of arr) {
                    const fn = String(t.filename || '');
                    if (!fn.toLowerCase().includes(want)) continue;
                    if (/\b(cam|ts|hdcam)\b/i.test(fn)) continue;
                    const seeds = t.seeds || 0;
                    if (seeds < 3) continue;
                    const quality = /2160p/i.test(fn) ? '2160p' : /1080p/i.test(fn) ? '1080p' : /720p/i.test(fn) ? '720p' : '480';
                    cands.push({ hash: String(t.hash).toLowerCase(), quality, seeds, name: fn });
                }
                cands.sort((a, b) => ((b.quality === '1080p') - (a.quality === '1080p')) || (b.seeds - a.seeds));
                mg = cands[0] || null;
            } catch (_) {}
            if (!mg) {
                try {
                    const want = `s${String(season || 1).padStart(2, '0')}e${String(episode || 1).padStart(2, '0')}`;
                    const yr3 = await fetch(`https://apibay.org/q.php?q=${encodeURIComponent(`${title.trim()} ${want}`)}`, { signal: AbortSignal.timeout(15000) });
                    const arr3 = await yr3.json();
                    const cands3 = [];
                    if (Array.isArray(arr3)) for (const t of arr3) {
                        if (!t || !t.info_hash || /^0{40}$/.test(t.info_hash)) continue;
                        const nm = String(t.name || '');
                        if (!nm.toLowerCase().includes(want)) continue;
                        if (/\b(cam|ts|hdcam)\b/i.test(nm)) continue;
                        const seeds = parseInt(t.seeders || '0', 10) || 0;
                        if (seeds < 3) continue;
                        const szn = parseInt(t.size || '0', 10);
                        if (szn && szn < 120 * 1024 * 1024) continue;
                        const quality = /2160p/i.test(nm) ? '2160p' : /1080p/i.test(nm) ? '1080p' : /720p/i.test(nm) ? '720p' : '480';
                        cands3.push({ hash: t.info_hash.toLowerCase(), quality, seeds, name: nm });
                    }
                    cands3.sort((a, b) => ((b.quality === '1080p') - (a.quality === '1080p')) || (b.seeds - a.seeds));
                    mg = cands3[0] || null;
                    if (mg) console.log(`[TR] TPB-TV fallback hit: ${mg.quality} (${mg.seeds} seeds)`);
                } catch (_) {}
            }
        }
        if (!mg) { console.log('[TR] no torrents found for', title); return null; }
        const dir = TR_DIR_PREFIX + tmdbId;
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[TR] torrent fallback: "${title}" ${mg.quality} (${mg.seeds} seeds)...`);
const TR_TRACKERS = '&tr=' + encodeURIComponent('udp://tracker.opentrackr.org:1337/announce') + '&tr=' + encodeURIComponent('udp://open.tracker.cl:1337/announce') + '&tr=' + encodeURIComponent('udp://exodus.desync.com:6969/announce') + '&tr=' + encodeURIComponent('http://tracker.files.fm:6969/announce') + '&tr=' + encodeURIComponent('wss://tracker.openwebtorrent.com');
        const wt = spawn(process.execPath, [path.join(__dirname, 'node_modules', 'webtorrent-cli', 'bin', 'cmd.js'), 'download', `magnet:?xt=urn:btih:${mg.hash}&dn=${encodeURIComponent(mg.name)}${TR_TRACKERS}`, '--out', dir, '--keep-seeding'], { stdio: ['ignore', 'ignore', 'ignore'] });
        wt.on('error', () => {});
        trActiveProc = wt;
        const deadline = Date.now() + 180000;
        let lastSz = -1, stall = 0;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 3000));
            const files = (() => { try { return fs.readdirSync(dir); } catch (_) { return []; } })();
            let big = null, bigSz = 0;
            for (const f of files) {
                try {
                    const st = fs.statSync(path.join(dir, f));
                    if (st.isFile() && st.size > bigSz && /\.(mp4|mkv|avi)$/i.test(f)) { big = path.join(dir, f); bigSz = st.size; }
                } catch (_) {}
            }
            if (big && bigSz >= 20 * 1024 * 1024) {
                console.log(`[TR] ready early: ${big} (${Math.round(bigSz / 1048576)}MB downloaded)`);
                return { title, year: '', sources: [{ url: big, quality: mg.quality === '2160p' ? '4K' : '720', server: 'Torrent-' + mg.quality }], subUrl: null };
            }
            if (bigSz > 0 && bigSz === lastSz) { if (++stall >= 12) break; } else { stall = 0; lastSz = bigSz; }
        }
        console.log('[TR] download stalled/timeout');
        try { wt.kill('SIGKILL'); } catch (_) {}
        if (trActiveProc === wt) trActiveProc = null;
        return null;
    } catch (e) { console.error('[TR] error:', e.message); return null; }
}

function trArabicSrt(tmdbId) {
    try {
        const dir = TR_DIR_PREFIX + tmdbId;
        const files = fs.readdirSync(dir).filter(f => /\.srt$/i.test(f));
        if (!files.length) return null;
        const pick = files.find(f => /arab|ara\.|\.ar\.|-ar_|^ar[\._]/i.test(f))
            || files.find(f => /\barabic\b/i.test(f))
            || null;
        if (!pick) return null;
        const dst = `/tmp/vlsub_tr_${tmdbId}_${Date.now()}.srt`;
        fs.copyFileSync(path.join(dir, pick), dst);
        console.log(`[TR] embedded arabic sub found: ${pick}`);
        return dst;
    } catch (_) { return null; }
}
const SUBDL_API_KEY = readEnvKey('SUBDL_API_KEY');
async function subdlArabicSub(type, tmdbId, s, e) {
    try {
        if (!SUBDL_API_KEY) { console.log('[SUBDL] missing API key - add SUBDL_API_KEY to .env (free at subdl.com/panel/api)'); return null; }
        const qs = new URLSearchParams({ api_key: SUBDL_API_KEY, tmdb_id: String(tmdbId), type: type === 'tv' ? 'tv' : 'movie', languages: 'AR', subs_per_page: '5' });
        if (type === 'tv') { if (s) qs.set('season_number', String(s)); if (e) qs.set('episode_number', String(e)); }
        const r = await fetch(`https://api.subdl.com/api/v1/subtitles?${qs}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
        const j = await r.json().catch(() => null);
        if (!j || !j.status || !Array.isArray(j.subtitles) || !j.subtitles.length) { console.log('[SUBDL] no arabic result'); return null; }
        const ar = j.subtitles.find(x => (x.language || '').toUpperCase() === 'AR' && /srt/i.test(x.format || 'srt')) || j.subtitles.find(x => (x.language || '').toUpperCase() === 'AR') || j.subtitles[0];
        if (!ar || !ar.url) return null;
        let dlUrl = ar.url.startsWith('http') ? ar.url : `https://dl.subdl.com${ar.url}`;
        const needsUnpack = ar.url && ar.url.endsWith('.zip');
        if (needsUnpack && SUBDL_API_KEY) dlUrl += (dlUrl.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(SUBDL_API_KEY);
        const rb = await fetch(dlUrl, { signal: AbortSignal.timeout(20000) });
        if (!rb.ok) { console.log('[SUBDL] dl http', rb.status); return null; }
        const ab = Buffer.from(await rb.arrayBuffer());
        const isZip = ab.length > 2 && ab[0] === 0x50 && ab[1] === 0x4B;
        let srtText = '';
        if (isZip) {
            const tmpZip = `/tmp/subdl_${tmdbId}_${Date.now()}.zip`;
            fs.writeFileSync(tmpZip, ab);
            try {
                const { execSync } = require('child_process');
                const list = execSync(`unzip -l "${tmpZip}" 2>/dev/null | grep -i "\\.srt" | head -1`, { encoding: 'utf8' });
                const m = list.match(/\s(\S+\.srt)\s*$/i);
                const pick = m ? m[1] : null;
                if (pick) srtText = execSync(`unzip -p "${tmpZip}" "${pick}" 2>/dev/null`, { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
                else {
                    const all = execSync(`unzip -p "${tmpZip}" 2>/dev/null`, { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
                    srtText = all;
                }
            } catch (_) { srtText = ''; }
            try { fs.unlinkSync(tmpZip); } catch (_) {}
            if (!srtText || !srtText.includes('-->')) { console.log('[SUBDL] zip no srt found'); return null; }
        } else {
            srtText = ab.toString('utf8');
            if (/\ufffd{2,}/.test(srtText.slice(0, 4000))) srtText = ab.toString('latin1');
        }
        if (!srtText.includes('-->') || srtText.length < 200) return null;
        const dst = `/tmp/vlsub_subdl_${tmdbId}_${Date.now()}.srt`;
        fs.writeFileSync(dst, srtText, 'utf8');
        console.log(`[SUBDL] arabic saved (${Math.round(srtText.length / 1024)}KB)`);
        return dst;
    } catch (e) { console.log('[SUBDL] error:', e.message); return null; }
}
const OPENSUB_API_KEY = readEnvKey('OPENSUB_API_KEY');
async function osArabicSub(type, tmdbId, s, e) {
    try {
        if (!OPENSUB_API_KEY) return null;
        const qs = new URLSearchParams({ tmdb_id: String(tmdbId), languages: 'ar' });
        if (type === 'tv') { qs.set('type', 'episode'); if (s) qs.set('season_number', String(s)); if (e) qs.set('episode_number', String(e)); }
        else qs.set('type', 'movie');
        const r1 = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?${qs}`, { headers: { 'Api-Key': OPENSUB_API_KEY, 'User-Agent': 'iptv-bot v1' }, signal: AbortSignal.timeout(15000) });
        const j1 = await r1.json();
        const fid = j1 && j1.data && j1.data[0] && j1.data[0].attributes && j1.data[0].attributes.files && j1.data[0].attributes.files[0] && j1.data[0].attributes.files[0].file_id;
        if (!fid) { console.log('[OS] no arabic subtitle found'); return null; }
        const r2 = await fetch('https://api.opensubtitles.com/api/v1/download', { method: 'POST', headers: { 'Api-Key': OPENSUB_API_KEY, 'User-Agent': 'iptv-bot v1', 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ file_id: fid }), signal: AbortSignal.timeout(15000) });
        const j2 = await r2.json();
        const link = j2 && j2.link;
        if (!link) { console.log('[OS] download link denied (quota?)'); return null; }
        const r3 = await fetch(link, { signal: AbortSignal.timeout(20000) });
        const buf = Buffer.from(await r3.arrayBuffer());
        let text = buf.toString('utf8');
        if (/\ufffd{2,}/.test(text.slice(0, 4000))) text = buf.toString('latin1').replace(/[^\x00-\xFF\u0600-\u06FF\s\S]/g, '');
        if (/^\s*\d+\s*$/m.test(text) && /\u0600-\u06FF|-->/.test(text)) {
            const dst = `/tmp/vlsub_os_${tmdbId}_${Date.now()}.srt`;
            fs.writeFileSync(dst, text, 'utf8');
            console.log(`[OS] arabic subtitle saved (${Math.round(buf.length / 1024)}KB)`);
            return dst;
        }
        return null;
    } catch (e) { console.error('[OS] error:', e.message); return null; }
}

async function vdArabicSub(type, id, s, e) {
    try {
        const u = type === 'tv'
            ? `https://sub.vdrk.site/v2/tv/${id}/${s || 1}/${e || 1}`
            : `https://sub.vdrk.site/v2/movie/${id}`;
        const arr = JSON.parse(await ccFetch(u));
        if (Array.isArray(arr)) {
            const ok = arr.filter(x => x && (x.file || x.url));
            const ar = ok.find(x => /arabic/i.test(x.label || x.language || '')) ||
                       ok.find(x => /^ar(\b|_|$)/i.test(String(x.language || '')));
            if (ar) return ar.file || ar.url;
        }
    } catch (_) {}
    const directs = type === 'tv'
        ? [`https://cache.vdrk.site/v3/tv/${id}/${s || 1}/${e || 1}/Arabic.vtt`, `https://cache.vdrk.site/v1/vtt/tv/${id}/${s || 1}/${e || 1}/Arabic.vtt`]
        : [`https://cache.vdrk.site/v3/movie/${id}/Arabic.vtt`, `https://cache.vdrk.site/v1/vtt/movie/${id}/Arabic.vtt`];
    for (const du of directs) {
        try {
            const t = await ccFetch(du);
            if (t && t.includes('-->') && t.length > 500) return du;
        } catch (_) {}
    }
    return null;
}

const providerHealth = {};
const PH_FILE = '/tmp/provider_health.json';
function phLoad() { try { Object.assign(providerHealth, JSON.parse(fs.readFileSync(PH_FILE, 'utf8'))); } catch (_) {} }
function phSave() { try { fs.writeFileSync(PH_FILE, JSON.stringify(providerHealth)); } catch (_) {} }
function phVal(p) {
    const h = providerHealth[p];
    if (h && Date.now() - h.t > 15 * 60000) { delete providerHealth[p]; return 0; }
    return h ? h.n : 0;
}
function phBump(p) { const h = providerHealth[p] || (providerHealth[p] = { n: 0 }); h.n++; h.t = Date.now(); phSave(); }
function phReset(p) { delete providerHealth[p]; phSave(); }
const PH_SKIP = 4;
const SUB_MEM_FILE = '/tmp/subsync_mem.json';
let subSyncMem = {};
try { subSyncMem = JSON.parse(fs.readFileSync(SUB_MEM_FILE, 'utf8')); } catch (_) {}
function subMemSave() { try { fs.writeFileSync(SUB_MEM_FILE, JSON.stringify(subSyncMem)); } catch (_) {} }
let activeTmdbId = '';
let activeSubSource = '';
const FFS_BIN = '/home/master/.local/bin/ffsubsync';
function srtFirstCueSec(p) {
    try {
        const m = fs.readFileSync(p, 'utf8').match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->/);
        return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+((m[4] || '0').padEnd(3, '0'))) / 1000 : null;
    } catch (_) { return null; }
}
function ffSubSyncOffset(videoUrl, srtPath) {
    return new Promise((resolve) => {
        try {
            if (!fs.existsSync(FFS_BIN)) { console.log('[SUBS] ffsubsync binary missing'); return resolve(null); }
            const out = srtPath.replace(/\.srt$/, '_ffs.srt');
            const args = [videoUrl, '-i', srtPath, '-o', out, '--max-duration-seconds', '480'];
            let killed = false, log = '';
            const p = spawn(FFS_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            const to = setTimeout(() => { killed = true; try { p.kill('SIGKILL'); } catch (_) {} }, 170000);
            p.stdout.on('data', d => { log += d.toString(); });
            p.stderr.on('data', d => { log += d.toString(); });
            p.on('close', (code) => {
                clearTimeout(to);
                if (killed) { console.log('[SUBS] ffsubsync timeout'); return resolve(null); }
                if (code !== 0 || !fs.existsSync(out)) {
                    console.log('[SUBS] ffsubsync failed exit=' + code + ':', log.split('\n').slice(-2).join(' ').slice(0, 200));
                    return resolve(null);
                }
                console.log('[SUBS] ffsubsync OK');
                resolve(out);
            });
        } catch (_) { resolve(null); }
    });
}
function probeSilenceEnds(url, hdrs, seconds) {    return new Promise((resolve) => {
        try {
            const ua = (hdrs && (hdrs['user-agent'] || hdrs.userAgent)) || 'Mozilla/5.0 (Windows NT 10.0) Chrome/124';
            const ref = hdrs && hdrs.referer;
            const hstr = 'User-Agent: ' + ua + '\r\n' + (ref ? 'Referer: ' + ref + '\r\n' : '') + 'Accept: */*\r\n';
            const args = ['-hide_banner', '-nostats', '-loglevel', 'info', '-headers', hstr, '-t', String(seconds || 150), '-i', url, '-vn', '-af', 'silencedetect=noise=-30dB:d=1.5', '-f', 'null', '-'];
            let err = ''; let killed = false;
            const p = spawn('/usr/bin/ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
            const to = setTimeout(() => { killed = true; try { p.kill('SIGKILL'); } catch (_) {} }, 42000);
            p.stderr.on('data', d => { err += d.toString(); });
            p.on('close', () => {
                clearTimeout(to);
                if (killed) return resolve([]);
                const outs = [...err.matchAll(/silence_end:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
                resolve(outs);
            });
        } catch (_) { resolve([]); }
    });
}

async function probePlayable(src) {
    try {
        const u = (src && src.url) || '';
        if (!/^https?:\/\//i.test(u)) return true;
        const hdrs = Object.assign({}, src.headers || {});
        if (!hdrs['user-agent']) hdrs['user-agent'] = CC_UA;
        hdrs.range = 'bytes=0-1023';
        const r = await fetch(u, { headers: hdrs, signal: AbortSignal.timeout(6000), redirect: 'follow' });
        return r.ok || r.status === 206;
    } catch (_) { return false; }
}
async function pickAcrossProviders(type, id, s, e) {
    const fns = {
        VL: () => vlSources(type, id),
        VK: () => vkSources(type, id, s, e),
        CC: () => ccSources(type, id),
        MG: () => mgSources(type, id, s, e),
        ST: () => stSources(type, id),
    };
    const healthy = ['VL', 'VK', 'CC', 'MG', 'ST'].filter(p => phVal(p) < PH_SKIP);
    console.log(`[RACE] asking ${healthy.join('+')} in parallel...`);
    const settled = await Promise.all(healthy.map(async (p) => {
        try { return { p, res: await fns[p]() }; } catch (_) { return { p, res: null }; }
    }));
    for (const p of healthy) {
        const hit = settled.find(x => x.p === p);
        const res = hit && hit.res;
        if (!res || !res.sources || !res.sources.length) continue;
        const ranked = vkPickBest(res.sources, '720', true) || [];
        for (const cand of ranked.slice(0, 3)) {
            console.log(`[RACE] probing ${p} ${cand.quality || ''} ${cand.server || ''}...`);
            if (await probePlayable(cand)) return { provider: p, res, best: cand };
            console.log(`[RACE] ${p} source failed probe -> next candidate`);
        }
        phBump(p);
    }
    return null;
}

async function pickAlive(cands) {
    if (!cands || !cands.length) return null;
    const objs = cands.map(c => typeof c === 'string' ? { url: c, quality: 'auto' } : c);
    const ranked = vkPickBest(objs, '720', true);
    for (const c of ranked.slice(0, 3)) {
        if (!/^https?:\/\//i.test(c.url || '')) return [c];
        if (await probePlayable(c)) return [c];
        console.log(`[ROTATE] candidate failed probe (${c.server || c.quality || '?'}) -> next`);
    }
    return null;
}
function makeCrossRefresh(type, id, s, e, state) {
    return async (mode) => {
        if (mode === 'seek') state.fastFails = 0;
        else if (mode === 'fast') state.fastFails = (state.fastFails || 0) + 1;
        else if (mode === 'slow') state.fastFails = 0;
        const burned = (state.fastFails || 0) >= 2;

        if (state.provider === 'VL') {
            let picked = null;
            const vlDead = phVal('VL') >= PH_SKIP;
            if (!burned && !vlDead) {
                try {
                    const r2 = await vlSources(type, id, s, e);
                    if (r2 && r2.sources.length) {
                        picked = await pickAlive(r2.sources);
                        if (picked) console.log(`[VL] refresh -> ${picked[0].quality} (probe ok)`);
                    }
                } catch (_) {}
            }
            if (picked) { phReset('VL'); return picked; }
            if (burned) { if (vlDead) console.log('[ROTATE] VL still dead -> skipping'); else phBump('VL'); }
            console.log(burned ? '[ROTATE] VL dying instantly x3 -> switching to VK' : '[ROTATE] VL failed -> switching to VK');
            state.provider = 'VK';
            state.fastFails = 0;
        }
        if (state.provider === 'VK') {
            let picked = null;
            const vkDead = phVal('VK') >= PH_SKIP;
            if (!burned && !vkDead) {
                try {
                    const r3 = await vkSources(type, id, s, e);
                    if (r3 && r3.sources.length) {
                        picked = await pickAlive(r3.sources);
                        if (picked) console.log(`[VK] refresh -> ${picked[0].server} ${picked[0].quality} (probe ok)`);
                    }
                } catch (_) {}
            }
            if (picked) { phReset('VK'); return picked; }
            if (burned) { if (vkDead) console.log('[ROTATE] VK still dead -> skipping'); else phBump('VK'); }
            console.log(burned ? '[ROTATE] VK dying instantly x3 -> switching to 2Embed' : '[ROTATE] VK failed -> switching to 2Embed');
            state.provider = 'CC';
            state.fastFails = 0;
        }
        let ccPick = null;
        if (state.provider === 'CC' && !burned && phVal('CC') < PH_SKIP) {
            try {
                const r4 = await ccSources(type, id, s, e);
                if (r4 && r4.sources.length) {
                    ccPick = await pickAlive(r4.sources);
                    if (ccPick) console.log(`[CC] refresh -> ${ccPick[0].server} (probe ok)`);
                }
            } catch (_) {}
        }
        if (ccPick) { phReset('CC'); return ccPick; }
        if (state.provider === 'CC' && burned) phBump('CC');
        console.log(burned ? '[ROTATE] 2Embed dying instantly x3 -> switching to MegaEmbed' : '[ROTATE] 2Embed failed -> switching to MegaEmbed');
        state.provider = 'MG';
        state.fastFails = 0;
        state.mgTries = 0;
        let mgPick = null;
        if (!burned && phVal('MG') < PH_SKIP) {
            try {
                const rm = await mgSources(type, id, s, e);
                if (rm && rm.sources.length) {
                    if ((state.mgTries || 0) >= rm.sources.length + 1) {
                        console.log('[ROTATE] MegaEmbed sources exhausted -> switching to 111movies');
                        phBump('MG');
                    } else {
                        const pick = rm.sources[state.idx % rm.sources.length];
                        state.idx++;
                        state.mgTries++;
                        console.log(`[MG] refresh -> ${pick.server}`);
                        mgPick = await pickAlive([pick]);
                    }
                }
            } catch (_) {}
        }
        if (mgPick) { phReset('MG'); state.cycleFails = 0; state.mgTries = 0; return mgPick; }
        if (burned) phBump('MG');
        console.log('[ROTATE] MegaEmbed failed -> switching to 111movies');
        state.provider = 'ST';
        state.fastFails = 0;
        try {
            const r5 = await stSources(type, id, s, e);
            if (r5 && r5.sources.length) {
                const stPick = await pickAlive(r5.sources);
                if (stPick) {
                    state.cycleFails = 0;
                    phReset('ST');
                    console.log('[ST] refresh -> 111movies (probe ok)');
                    return stPick;
                }
            }
        } catch (_) {}
        if (burned) phBump('ST');
        state.cycleFails = (state.cycleFails || 0) + 1;
        if (state.provider === 'ST' && state.cycleFails < 8) {
            console.log('[ROTATE] 111movies failed -> back to VL for fresh urls');
            state.provider = 'VL';
        }
        return null;
    };
}



async function getYtDlpInfo(url) {
    const cookiesArg = fs.existsSync(COOKIES_PATH) ? `--cookies "${COOKIES_PATH}"` : '';
    try {
        const { stdout } = await execAsync(
            `${YTDLP_PATH} ${cookiesArg} --dump-json --no-playlist "${url}" 2>/dev/null`,
            { timeout: 30000, maxBuffer: 1024 * 1024 * 10 }
        );
        return JSON.parse(stdout);
    } catch (e) {
        console.error('[yt-dlp] info error:', e.message);
        return null;
    }
}

async function getYtDlpStreamUrl(url, qualityHeight) {
    const formatArg = qualityHeight
        ? `bestvideo[height<=${qualityHeight}]+bestaudio/best[height<=${qualityHeight}]/best`
        : 'bestvideo[height<=1080]+bestaudio/best';
    const cookiesArg = fs.existsSync(COOKIES_PATH) ? `--cookies "${COOKIES_PATH}"` : '';
    try {
        const { stdout } = await execAsync(
            `${YTDLP_PATH} ${cookiesArg} -f "${formatArg}" --get-url --no-playlist "${url}" 2>/dev/null`,
            { timeout: 30000, maxBuffer: 1024 * 1024 * 10 }
        );
        return stdout.trim().split('\n').filter(Boolean);
    } catch (e) {
        console.error('[yt-dlp] stream url error:', e.message);
        return null;
    }
}

async function startYtStream(urls, quality, message, title, refresher, subsPath) {
    const urlList = Array.isArray(urls) ? urls.filter(Boolean) : [urls];
    const asSrc = (x) => (typeof x === 'string' ? { url: x } : (x && x.url ? x : {}));
    let curSrc = asSrc(urlList[0]);
    let videoUrl = curSrc.url;
    let audioUrl = urlList[1] ? asSrc(urlList[1]).url : null;
    reconnectAttempts = 0;
    seekOffset = 0;
    wdKillStreak = 0;
    wdLastPos = 0;
    pendingSeek = null;
    subDelayAdj = 0;
    if (activeTmdbId && subSyncMem[activeTmdbId] != null) {
        subDelayAdj = subSyncMem[activeTmdbId];
        console.log(`[SUBS] applying saved sync ${subDelayAdj}s for tmdb ${activeTmdbId}`);
    }
    seekFails = 0;
    isPaused = false;
    mediaInfo = { title: title || currentChannelName || 'media', live: false, offsetBase: 0, runStartedAt: Date.now(), paused: false, pauseStartedAt: null };
    const { width, height, fps, bitrate, maxrate, bufsize } = quality;

    let subBaseBuf = null;
    if (subsPath) { try { subBaseBuf = fs.readFileSync(subsPath); } catch (_) {} }
    let rescueCount = 0;
    const RESCUE_MAX = 4;
    const shiftSrt = (offRaw) => {
        const off = offRaw - subDelayAdj;
        if (!subBaseBuf || off === 0) return subsPath;
        const fmt = (t) => {
            let ms = Math.round(t * 1000);
            if (ms < 0) ms = 0;
            const hh = Math.floor(ms / 3600000); ms -= hh * 3600000;
            const mm = Math.floor(ms / 60000); ms -= mm * 60000;
            const ss = Math.floor(ms / 1000); ms -= ss * 1000;
            return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
        };
        const lines = subBaseBuf.toString('utf8').split('\n');
        const out = [];
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            const m = l.match(/^\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
            if (!m) { out.push(l); continue; }
            const frac = (g) => { const v = String(m[g] || ''); return (+v || 0) / Math.pow(10, v.length || 1); };
            const st = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + frac(4);
            const en = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + frac(8);
            if (en - off <= 0.05) {
                while (i + 1 < lines.length && lines[i + 1].trim() !== '' && !lines[i + 1].includes('-->')) i++;
                continue;
            }
            out.push(`${fmt(st - off)} --> ${fmt(en - off)}`);
        }
        const p2 = subsPath.replace(/\.srt$/i, '') + `_sh${Math.floor(off)}s.srt`;
        try { fs.writeFileSync(p2, out.join('\n')); console.log(`[SUBS] shifted by ${Math.floor(off)}s -> ${p2}`); return p2; }
        catch (_) { return subsPath; }
    };

    let placeholderProc = null;
    const stopPlaceholder = () => {
        if (placeholderProc) { try { placeholderProc.kill('SIGKILL'); } catch (_) {} }
        placeholderProc = null;
    };
    const startPlaceholder = () => {
        if (!isPlaying || placeholderProc) return;
        if (!fs.existsSync('/tmp/loading.png')) return;
        try { streamer.stopStream(); } catch (_) {}
        try {
            placeholderProc = spawn(ffmpegPath, [
                '-hide_banner', '-loglevel', 'error',
                '-loop', '1', '-framerate', String(Math.min(fps, 15)), '-i', '/tmp/loading.png',
                '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
                '-shortest',
                '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
                '-profile:v', 'main', '-level', '4.1',
                '-c:a', 'libopus', '-b:a', '128k', '-ac', '2', '-ar', '48000',
                '-s', `${width}x${height}`, '-r', String(fps),
                '-b:v', '1200k', '-maxrate', '1500k', '-bufsize', '2400k',
                '-pix_fmt', 'yuv420p', '-g', '60',
                '-f', 'mpegts', 'pipe:1',
            ], { stdio: ['pipe', 'pipe', 'pipe'] });
            placeholderProc.on('exit', () => { placeholderProc = null; });
            const pbuf = new PassThrough({ highWaterMark: 512 * 1024 });
            pbuf.on('error', () => {});
            placeholderProc.stdout.pipe(pbuf);
            playStream(pbuf, streamer, {
                type: 'go-live',
                format: 'mpegts',
                width: width,
                height: height,
                frameRate: fps,
            }).catch(() => {});
            console.log('[LOAD] loading screen on air');
        } catch (e) {
            console.error('[LOAD] placeholder failed:', e.message);
            placeholderProc = null;
        }
    };

    while (reconnectAttempts < MAX_RECONNECT) {
        if (!isPlaying) break;

        console.log(`[YT] Starting: ${title} (attempt ${reconnectAttempts + 1})`);

            try {
                await joinVoiceSafe();
                if (!placeholderProc) { try { streamer.stopStream(); } catch (_) {} }
                if (activePlayPromise) {
                    await Promise.race([activePlayPromise.catch(() => {}), sleep(4000)]);
                    activePlayPromise = null;
                }
                await sleep(300);
            } catch (e) {
                isPlaying = false;
                return reply(message, `❌ فشل دخول الروم: ${e.message}`);
            }

        const vlCutSubs = activeSubSource === 'vl_fallback' || (activeSubSource === 'vdrk' && !['VL', 'ST'].includes(activeProvider || ''));
        if (seekOffset === 0 && subDelayAdj === 0 && subBaseBuf && vlCutSubs && videoUrl) {
            try {
                console.log('[SUBS] auto-sync: ffsubsync audio alignment (once per title, ~1-2min)...');
                const synced = await ffSubSyncOffset(videoUrl, subsPath);
                let done = false;
                if (synced) {
                    const a = srtFirstCueSec(subsPath), b = srtFirstCueSec(synced);
                    if (a !== null && b !== null) {
                        const adj = Math.round(b - a);
                        if (Math.abs(adj) >= 1 && adj >= -600 && adj <= 600) {
                            subDelayAdj = adj;
                            if (activeTmdbId) { subSyncMem[activeTmdbId] = adj; subMemSave(); }
                            console.log(`[SUBS] FFSYNC applied ${adj}s (saved permanently for this title)`);
                            done = true;
                        } else console.log('[SUBS] ffsubsync delta negligible:', adj);
                    }
                }
                if (!done) {
                    const fc0 = srtFirstCueSec(subsPath);
                    const fc = fc0 === null ? 0 : fc0;
                    console.log('[SUBS] fallback: probing intro silences...');
                    const ends = await probeSilenceEnds(videoUrl, curSrc.headers, 150);
                    const cands = ends.filter(t => t >= 15 && t <= 135);
                    if (cands.length) {
                        const introEnd = Math.max(...cands);
                        const adj = Math.round(introEnd - fc);
                        if (adj >= 10 && adj <= 165) {
                            subDelayAdj = adj;
                            if (activeTmdbId) { subSyncMem[activeTmdbId] = adj; subMemSave(); }
                            console.log(`[SUBS] AUTO-SYNC applied +${adj}s (intro end ${Math.round(introEnd)}s vs first cue ${fc.toFixed(1)}s)`);
                        } else console.log('[SUBS] auto-sync adj out of range:', adj, '- skipping');
                    } else console.log('[SUBS] no silence anchors found - playing unsynced, use !subdelay');
                }
            } catch (e) { console.log('[SUBS] auto-sync error:', e.message); }
        }

        try {
            await new Promise((resolve, reject) => {
                const mkInput = (u, hdrs, extPicky, inSS) => {
                    const hparts = [];
                    const ua = (hdrs && (hdrs['user-agent'] || hdrs.userAgent || hdrs.ua)) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
                    hparts.push('User-Agent: ' + ua);
                    if (hdrs && hdrs.referer) hparts.push('Referer: ' + hdrs.referer);
                    if (hdrs && hdrs.origin) hparts.push('Origin: ' + hdrs.origin);
                    hparts.push('Accept: */*', 'Accept-Language: en-US,en;q=0.9', 'Connection: keep-alive');
                    return [
                        ...(extPicky ? ['-extension_picky', '0', '-protocol_whitelist', 'file,http,https,tcp,tls,crypto'] : []),
                        ...(/^https?:\/\//i.test(u) ? ['-headers', hparts.join('\r\n') + '\r\n'] : []),
                        ...(inSS > 0 ? ['-ss', String(Math.floor(inSS))] : []),
                        ...(/^https?:\/\//i.test(u) ? ['-readrate', '1.05'] : []),
                        '-reconnect', '1',
                        '-reconnect_streamed', '1',
                        '-reconnect_delay_max', '5',
                        '-reconnect_on_network_error', '1',
                        '-rw_timeout', '10000000',
                        '-analyzeduration', '2000000',
                        '-probesize', '10000000',
                        '-fflags', '+discardcorrupt+igndts',
                        '-err_detect', 'ignore_err',
                        '-thread_queue_size', '16384',
                        '-i', u,
                    ];
                };
                const PRE_SEEK = 15;
                const inSS = seekOffset > PRE_SEEK ? seekOffset - PRE_SEEK : 0;
                const outSS = seekOffset > 0 ? seekOffset - inSS : 0;
                const inputArgs = audioUrl
                    ? [...mkInput(videoUrl, curSrc.headers, curSrc.extPicky, inSS), ...mkInput(audioUrl, null, false, inSS)]
                    : mkInput(videoUrl, curSrc.headers, curSrc.extPicky, inSS);
                const subStyle = [
                    'FontName=Noto Sans Arabic',
                    'FontSize=24',
                    'Bold=1',
                    'PrimaryColour=&H00FFFFFF',
                    'OutlineColour=&H00000000',
                    'BackColour=&HA0000000',
                    'BorderStyle=1',
                    'Outline=2',
                    'Shadow=1',
                    'Spacing=0',
                    'Alignment=2',
                    'MarginV=25',
                ].join(',');
                const burnSubs = (seekOffset > 0 || subDelayAdj !== 0) ? shiftSrt(seekOffset) : subsPath;
                const args = [
                    '-hide_banner', '-loglevel', 'warning',
                    ...inputArgs,
                    ...(outSS > 0 ? ['-ss', String(Math.floor(outSS))] : []),
                    ...(burnSubs
                        ? ['-vf', `scale=${width}:${height},format=yuv420p,subtitles=${burnSubs}:fontsdir=/home/master/.local/share/fonts:charenc=UTF-8:force_style='${subStyle}'`]
                        : ['-vf', `scale=${width}:${height},format=yuv420p`]),
                    '-fflags', '+genpts+discardcorrupt+nobuffer',
                    '-flags', '+low_delay+global_header',
                    '-max_muxing_queue_size', '4096',
                    ...(audioUrl ? ['-map', '0:v:0', '-map', '1:a:0', '-shortest'] : ['-map', '0:v:0', '-map', '0:a:0?']),
                    '-c:v', 'libx264',
                    '-preset', 'veryfast',
                    '-tune', 'zerolatency',
                    '-profile:v', 'main',
                    '-level', '4.1',
                    '-ar', '48000',
                    '-c:a', 'libopus',
                    '-b:a', '128k',
                    '-ac', '2',
                    '-s', `${width}x${height}`,
                    '-r', String(fps),
                    '-b:v', bitrate,
                    '-maxrate', maxrate,
                    '-bufsize', bufsize,
                    '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart',
                    '-row-mt', '1',
                    '-threads', '4',
                    '-f', 'mpegts',
                    'pipe:1',
                ];

                ffmpegProcess = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
                ffmpegStderrTail = '';
                wdLastBytes = 0;

                let stderrLog = '';
                ffmpegProcess.stderr.on('data', (c) => { stderrLog += c.toString(); ffmpegStderrTail = (ffmpegStderrTail + c.toString()).slice(-1600); });
                ffmpegProcess.stdout.on('error', () => {});
                ffmpegProcess.on('error', (err) => reject(err));
                ffmpegProcess.on('exit', (code, signal) => {
                    ffmpegProcess = null;
                    if (code !== 0 && code !== null && signal !== 'SIGKILL') {
                        const last = stderrLog.split('\n').slice(-4).join('\n');
                        console.error(`[FFmpeg] Exit code=${code}:\n${last}`);
                        reject(new Error(`FFmpeg exited code=${code}`));
                    } else {
                        console.log(`[FFmpeg] Exit code=${code} signal=${signal}`);
                        resolve();
                    }
                });

                abortController = new AbortController();
                abortController.signal.addEventListener('abort', () => { killFFmpeg(); resolve(); });

                const bufferStream = new PassThrough({ highWaterMark: 1024 * 1024 * 2 });
                bufferStream.on('error', () => {});
                streamBytes = 0;
                lastProgressAt = Date.now();
                bufferStream.on('data', (d) => { streamBytes += d.length; lastProgressAt = Date.now(); });
                ffmpegProcess.stdout.pipe(bufferStream);
                mediaBufferStream = bufferStream;
                if (mediaInfo) { mediaInfo.offsetBase = seekOffset; mediaInfo.runStartedAt = Date.now(); lastProgressAt = Date.now(); }

                stopPlaceholder();
                try { streamer.stopStream(); } catch (_) {}
                activePlayPromise = playStream(bufferStream, streamer, {
                    type: 'go-live',
                    format: 'mpegts',
                    width: selectedQuality.width,
                    height: selectedQuality.height,
                    frameRate: selectedQuality.fps,
                }).then(() => resolve()).catch(reject);
            });
        } catch (err) {
            const st = err && err.stack ? String(err.stack).split('\n').slice(1, 9).join(' | ') : '';
            console.error(`[YT] Error: ${String((err && err.message) || err)}${st ? '\n[STACK] ' + st : ''}`);
        }

        killFFmpeg();
        if (!isPlaying) break;
        startPlaceholder();

        if (pendingSeek !== null) {
            seekOffset = Math.max(0, Math.floor(pendingSeek));
            pendingSeek = null;
            reconnectAttempts = 0;
            console.log(`[YT] Seek -> ${seekOffset}s`);
            try { streamer.stopStream(); } catch (_) {}
            if (activePlayPromise) {
                await Promise.race([activePlayPromise.catch(() => {}), sleep(4000)]);
                activePlayPromise = null;
            }
            await sleep(500);
            continue;
        }

        const ranMs = Date.now() - (mediaInfo ? mediaInfo.runStartedAt : Date.now());
        if (seekOffset > 0 && ranMs < 8000 && seekFails < 8) {
            seekFails++;
            console.log(`[YT] Seeked run died fast (${Math.round(ranMs / 1000)}s), retry ${seekFails}/8 with fresh URL`);
            if (refresher) {
                try {
                    const nu = await refresher('seek');
                    if (nu && nu[0]) { curSrc = asSrc(nu[0]); urlList[0] = curSrc; videoUrl = curSrc.url; audioUrl = nu[1] ? asSrc(nu[1]).url : null; }
                } catch (_) {}
            }
            reconnectAttempts = 0;
            startPlaceholder();
            await sleep(4000);
            continue;
        }
        if (ranMs >= 30000) seekFails = 0;

        if (refresher && reconnectAttempts > 0) {
            try {
                const nu = await refresher(ranMs < 8000 ? 'fast' : 'slow');
                if (nu && nu[0]) {
                    curSrc = asSrc(nu[0]);
                    urlList[0] = curSrc;
                    videoUrl = curSrc.url;
                    audioUrl = nu[1] ? asSrc(nu[1]).url : null;
                    console.log('[YT] Refreshed source URL');
                }
            } catch (e) {
                console.error('[YT] refresh failed:', e.message);
            }
        }

        if (!pendingSeek && mediaInfo && !mediaInfo.live) {
            const endT = mediaInfo.paused && mediaInfo.pauseStartedAt ? mediaInfo.pauseStartedAt : Math.min(Date.now(), lastProgressAt || Date.now());
            const pos = (mediaInfo.offsetBase || 0) + Math.max(0, (endT - (mediaInfo.runStartedAt || endT)) / 1000);
            if (pos > 5) {
                console.log(`[YT] auto-resume from ${Math.floor(pos)}s`);
                seekOffset = Math.floor(pos);
            }
        }

        reconnectAttempts++;
        if (reconnectAttempts >= MAX_RECONNECT) {
            if (rescueCount < RESCUE_MAX && isPlaying) {
                rescueCount++;
                reconnectAttempts = 0;
                seekFails = 0;
                console.log(`[YT] retries exhausted -> rescue ${rescueCount}/${RESCUE_MAX}, reloading sources`);
                try { reply(message, `🔄 المصدر ضعيف شوية — جاري إعادة تحميل البث تلقائيًا (${rescueCount}/${RESCUE_MAX})...`); } catch (_) {}
                if (refresher) {
                    try {
                        const nu = await refresher('slow');
                        if (nu && nu[0]) { curSrc = asSrc(nu[0]); urlList[0] = curSrc; videoUrl = curSrc.url; audioUrl = nu[1] ? asSrc(nu[1]).url : null; }
                    } catch (_) {}
                }
                startPlaceholder();
                await sleep(15000);
                continue;
            }
        } else {
            if (ranMs >= 8000) startPlaceholder();
            await sleep(ranMs < 8000 ? 1200 : RECONNECT_DELAY);
        }
    }

    isPlaying = false;
    currentChannelName = null;
    mediaBufferStream = null;
    isPaused = false;
    mediaInfo = null;
    console.log('[YT] giving up after max retries/rescues');
    killFFmpeg();
    stopPlaceholder();
    try { streamer.stopStream(); } catch (_) {}
    try { streamer.leaveVoice(); } catch (_) {}
    return reconnectAttempts >= MAX_RECONNECT ? 'failed' : 'ended';
}

client.on('ready', async () => {
    console.log(`Logged in as: ${client.user.tag}`);
    try { await streamModReady; } catch (e) { console.error('[MOD] stream lib unavailable:', e.message); }
    if (Streamer && !streamer) streamer = new Streamer(client);
    console.log(`FFmpeg path: ${ffmpegPath || 'NOT FOUND'}`);
    phLoad();
    trKill();
    await fetchChannels();
    const cleanOldSubs = () => {
        try {
            const old = fs.readdirSync('/tmp').filter(f => /^vlsub_.*\.srt$/.test(f) && Date.now() - fs.statSync('/tmp/' + f).mtimeMs > 24 * 3600e3);
            old.forEach(f => { try { fs.unlinkSync('/tmp/' + f); } catch (_) {} });
            if (old.length) console.log(`[CLEAN] removed ${old.length} old subtitle files`);
        } catch (_) {}
    };
    cleanOldSubs();
    setInterval(cleanOldSubs, 60 * 60e3);
    (async () => {
        try {
            fs.writeFileSync('/tmp/loading.srt', '1\n00:00:00,000 --> 00:01:00,000\nجاري التحميل…\n');
            await execAsync(`/usr/bin/ffmpeg -y -loglevel error -f lavfi -i color=c=0x14141e:s=1280x720:d=1 -vf "subtitles=/tmp/loading.srt:fontsdir=/home/master/.local/share/fonts:charenc=UTF-8:force_style='FontName=Noto Sans Arabic,FontSize=30,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2.2,Shadow=0.8,Spacing=0,Alignment=5'" -frames:v 1 /tmp/loading.png`);
            console.log('[LOAD] loading screen ready');
        } catch (e) { console.error('[LOAD] png failed:', e.message); }
    })();
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!OWNER_IDS.includes(message.author.id)) return;

    try {
        if (message.content === '!tv') {
            const channels = await fetchChannels();
            if (!channels || Object.keys(channels).length === 0) {
                return reply(message, '❌ لا توجد قنوات متاحة.');
            }
            await showChannelsPage(message, channels, 1);
        }

        if (/^!tv\s+\d+$/.test(message.content)) {
            const page = parseInt(message.content.split(' ')[1], 10);
            const channels = await fetchChannels();
            if (!channels || Object.keys(channels).length === 0) {
                return reply(message, '❌ لا توجد قنوات متاحة.');
            }
            await showChannelsPage(message, channels, page);
        }

        if (message.content.startsWith('!quality ')) {
            const preset = message.content.split(' ')[1];
            if (!QUALITY_PRESETS[preset]) {
                return reply(message, '❌ الخيارات: 240p, 360p, 480p, 720p, 720pf, 1080p, 1440p, 4k, 8k');
            }
            selectedQuality = QUALITY_PRESETS[preset];
            await reply(message, `✅ الجودة: **${preset}** (${selectedQuality.width}x${selectedQuality.height}, ${selectedQuality.fps}fps, ${selectedQuality.bitrate})`);
        }

        if (message.content.startsWith('!play ')) {
            if (isPlaying) {
                return reply(message, '❌ يوجد بث قيد التشغيل. استعمل `!stop` أولاً.');
            }

            const channelKey = message.content.split(' ')[1];
            const channels = await fetchChannels();
            if (!channels) {
                return reply(message, '❌ تعذر جلب القنوات.');
            }

            const channel = channels[channelKey];
            if (!channel) {
                return reply(message, `❌ القناة رقم ${channelKey} غير موجودة. اكتب \`!tv\` لعرض القنوات.`);
            }

            isPlaying = true;
            currentChannelName = channel.name;

            await reply(message, `🎥 جاري تشغيل **${channel.name}** (${selectedQuality.width}x${selectedQuality.height})...`);
            console.log(`[Play] ${channel.name} - ${channel.url}`);

            await startStream(channel, message);
        }

        if (message.content.startsWith('!yt ')) {
            if (isPlaying) {
                return reply(message, '❌ يوجد بث قيد التشغيل. استعمل `!stop` أولاً.');
            }

            const parts = message.content.split(' ');
            const url = parts[1];
            let qualityKey = parts[2] || null;

            if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
                return reply(message, '❌ أدخل رابط يوتيوب صحيح.\n`!yt <رابط>` أو `!yt <رابط> 720p`');
            }

            if (qualityKey && !QUALITY_PRESETS[qualityKey]) {
                return reply(message, '❌ جودة غير صحيحة. الخيارات: 240p, 360p, 480p, 720p, 1080p, 4k');
            }

            await reply(message, '🔍 جاري تحليل الفيديو...');

            const info = await getYtDlpInfo(url);
            if (!info) {
                return reply(message, '❌ فشل تحليل الرابط. تأكد إنه رابط يوتيوب صحيح.');
            }

            const videoTitle = info.title || 'فيديو يوتيوب';
            const duration = info.duration ? `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')}` : '?';

            await reply(message, `🎬 **${videoTitle}**\n⏱️ المدة: ${duration}\n🔍 جاري جلب الرابط...`);

            let streamHeight = qualityKey ? QUALITY_PRESETS[qualityKey].height : selectedQuality.height;
            const streamUrls = await getYtDlpStreamUrl(url, streamHeight);
            if (!streamUrls || streamUrls.length === 0) {
                return reply(message, '❌ فشل جلب رابط البث.');
            }

            const ytQuality = qualityKey ? QUALITY_PRESETS[qualityKey] : selectedQuality;

            isPlaying = true;
            currentChannelName = videoTitle;

            await reply(message, `▶️ جاري تشغيل **${videoTitle}** (${ytQuality.width}x${ytQuality.height})...`);
            console.log(`[YT] Playing: ${videoTitle} - ${url}`);

            await startYtStream(streamUrls, ytQuality, message, videoTitle);

            await reply(message, `⏹️ انتهى تشغيل **${videoTitle}**`);
        }

        if (message.content.startsWith('!yts ')) {
            const query = message.content.slice(5).trim();
            if (!query) return reply(message, '❌ اكتب شيء تبحث عنه.\n`!yts <كلمة>`');

            await reply(message, `🔍 جاري البحث عن: **${query}**...`);

            try {
                const { stdout } = await execAsync(
                    `${YTDLP_PATH} --flat-playlist --dump-json "ytsearch10:${query}" 2>/dev/null`,
                    { timeout: 20000, maxBuffer: 1024 * 1024 * 5 }
                );
                const lines = stdout.trim().split('\n').filter(Boolean);
                if (lines.length === 0) return reply(message, '❌ لا توجد نتائج.');

                const results = lines.map((line, i) => {
                    const info = JSON.parse(line);
                    const dur = info.duration ? `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')}` : '?';
                    return `\`${i + 1}\` **${(info.title || '?').slice(0, 50)}** (${dur})`;
                }).join('\n');

                await reply(message, `🔍 **نتائج البحث:**\n\n${results}\n\n▶️ اكتب \`!yt <رابط>\` للتشغيل`);
            } catch (e) {
                console.error('[YT] search error:', e.message);
                await reply(message, '❌ فشل البحث.');
            }
        }

        if (message.content.startsWith('!movie ') || message.content.startsWith('!فيلم ')) {
            const q = message.content.split(' ').slice(1).join(' ').trim();
            if (!q) return reply(message, '❌ اكتب اسم الفيلم أو رقمه.\n`!movie فاست اكس` أو `!movie 385687`');
            if (!TMDB_API_KEY) return reply(message, '❌ مفتاح TMDB غير مضبوط.');

            await reply(message, '🔍 جاري البحث...');

            try {
                if (/^\d+$/.test(q)) {
                    const r = await fetch(`https://api.themoviedb.org/3/movie/${q}?api_key=${TMDB_API_KEY}&language=ar`, { signal: AbortSignal.timeout(15000) });
                    if (!r.ok) return reply(message, '❌ مفيش فيلم بالـ ID ده.');
                    const m = await r.json();
                    const year = (m.release_date || '').slice(0, 4);
                    let msg = `🎬 **${m.title}** ${year ? `(${year})` : ''}\n⭐ ${Number(m.vote_average).toFixed(1)}/10`;
                    if (m.overview) msg += `\n\n📝 ${m.overview.slice(0, 300)}`;
                    msg += `\n\n▶️ **شاهد الآن:**\n${vkMovieUrl(m.id)}`;
                    msg += `\n🎙️ للبث في الروم: \`!playmovie ${m.id}\``;
                    if (m.poster_path) msg += `\n\n${TMDB_IMG}${m.poster_path}`;
                    return reply(message, msg);
                }
                const results = await tmdbSearch('movie', q);
                if (!results || results.length === 0) return reply(message, '❌ مفيش نتائج. جرّب اسم تاني.');
                const list = results.slice(0, 5).map((x) => `${fmtTmdbLine(x)}\n↳ تشغيل: \`!movie ${x.id}\``).join('\n');
                await reply(message, `🎬 **نتائج البحث:**\n\n${list}`);
            } catch (e) {
                console.error('[TMDB] movie error:', e.message);
                return reply(message, '❌ حصل خطأ في البحث.');
            }
        }

        if (message.content.startsWith('!series ') || message.content.startsWith('!مسلسل ')) {
            const parts = message.content.split(' ').slice(1);
            if (!parts[0]) return reply(message, '❌ الاستخدام:\n`!series بريكنج باد` للبحث\n`!series 1396` للموسم 1 حلقة 1\n`!series 1396 2 5` لموسم وحلقة محددة');
            if (!TMDB_API_KEY) return reply(message, '❌ مفتاح TMDB غير مضبوط.');

            await reply(message, '🔍 جاري البحث...');

            try {
                if (/^\d+$/.test(parts[0])) {
                    const id = parts[0];
                    const s = parseInt(parts[1], 10) || 1;
                    const e = parseInt(parts[2], 10) || 1;
                    const r = await fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_API_KEY}&language=ar`, { signal: AbortSignal.timeout(15000) });
                    if (!r.ok) return reply(message, '❌ مفيش مسلسل بالـ ID ده.');
                    const m = await r.json();
                    const year = (m.first_air_date || '').slice(0, 4);
                    let msg = `📺 **${m.name}** ${year ? `(${year})` : ''}\n⭐ ${Number(m.vote_average).toFixed(1)}/10 | المواسم: ${m.number_of_seasons} | الحلقات: ${m.number_of_episodes}`;
                    if (m.overview) msg += `\n\n📝 ${m.overview.slice(0, 300)}`;
                    msg += `\n\n▶️ **شاهد الآن — موسم ${s} • حلقة ${e}:**\n${vkTvUrl(id, s, e)}\n\n💡 تقدر تغيّر الحلقة من قائمة الحلقات جوه المشغل.`;
                    msg += `\n🎙️ للبث في الروم: \`!playseries ${id} ${s} ${e}\``;
                    if (m.poster_path) msg += `\n\n${TMDB_IMG}${m.poster_path}`;
                    return reply(message, msg);
                }
                const query = parts.join(' ');
                const results = await tmdbSearch('tv', query);
                if (!results || results.length === 0) return reply(message, '❌ مفيش نتائج. جرّب اسم تاني.');
                const list = results.slice(0, 5).map((x) => `${fmtTmdbLine(x)}\n↳ تشغيل: \`!series ${x.id}\``).join('\n');
                await reply(message, `📺 **نتائج البحث:**\n\n${list}`);
            } catch (err) {
                console.error('[TMDB] tv error:', err.message);
                return reply(message, '❌ حصل خطأ في البحث.');
            }
        }


        // ===== Vidking playback commands =====
        if (message.content.startsWith('!playmovie ') || message.content.startsWith('!بثفيلم ')) {
            const rawArgs = message.content.split(' ').slice(1).join(' ').trim();
            if (!rawArgs) return reply(message, '❌ الاستخدام:\n`!playmovie joker` بالاسم\n`!playmovie 475557` بالـID');
            let id = rawArgs;
            let preTitle = '';
            if (!/^\d+$/.test(rawArgs)) {
                await reply(message, `🔎 جاري البحث عن **${rawArgs}**...`);
                const results = await tmdbSearch('movie', rawArgs);
                if (!results.length) return reply(message, `❌ ملقتش فيلم باسم **${rawArgs}**`);
                id = String(results[0].id);
                preTitle = results[0].title || results[0].name || '';
                console.log(`[MOVIE] "${rawArgs}" -> tmdb ${id} (${preTitle})`);
            }
            if (isPlaying) return reply(message, '❌ يوجد بث قيد التشغيل. استعمل `!stop` أولاً.');
            await reply(message, '🔍 جاري استخراج البث...');
            try {
                let res = null, best = null, provider = 'VL';
                const got = await pickAcrossProviders('movie', id);
                if (got) { provider = got.provider; res = got.res; best = got.best; }
                if (best && !res.title) res = { ...res, title: preTitle || 'الفيلم' };
                if (!best) {
                    await reply(message, '🧲 مفيش مصادر مباشرة — جاري تحميل نسخة تورنت (قد تأخذ دقيقة)...');
                    const tr = await trSources('movie', id);
                    if (!tr || !tr.sources.length) return reply(message, `❌ مفيش مصادر متاحة لـ **${preTitle || rawArgs}** حالياً. جرّب بعدين.`);
                    provider = 'TR'; res = tr; best = vkPickBest(tr.sources, '720');
                }
                let subPath = null;
                activeSubSource = '';
                subPath = await subdlArabicSub('movie', id);
                if (subPath) activeSubSource = 'subdl';
                if (!subPath && (provider === 'VL' || provider === 'ST') && res.subUrl) {
                    subPath = await vlFetchArabicSub(res.subUrl);
                    if (subPath) activeSubSource = 'vl';
                }
                if (!subPath) {
                    const alt = await vdArabicSub('movie', id);
                    if (alt) { console.log('[SUBS] vdrk movie sub found'); subPath = await vlFetchArabicSub(alt); if (subPath) activeSubSource = 'vdrk'; }
                    else console.log('[SUBS] vdrk: no movie coverage for', id);
                }
                if (!subPath) { subPath = trArabicSrt(id); if (subPath) activeSubSource = 'tr'; }
                if (!subPath) { subPath = await osArabicSub('movie', id); if (subPath) activeSubSource = 'os'; }
                if (!subPath && res.subUrl) {
                    console.log('[SUBS] last-resort: VL subs on', provider, 'video - auto-sync will calibrate');
                    subPath = await vlFetchArabicSub(res.subUrl);
                    if (subPath) activeSubSource = 'vl_fallback';
                }
                isPlaying = true;
                currentChannelName = res.title;
                await reply(message, `🎬 جاري بث **${res.title}** في الروم...${subPath ? ' 📝 بالترجمة العربية' : ''}`);
                console.log(`[${provider}] movie ${id} via ${best.server} ${best.quality}${subPath ? ' +subs' : ''}`);
                const rState = { provider, idx: 1 };
                const refresh = makeCrossRefresh('movie', id, 1, 1, rState);
        activeProvider = provider;
        activeTmdbId = String(id);
        const st = await startYtStream([best], selectedQuality, message, res.title, refresh, subPath);
        vlCleanupSub(subPath);
                isPlaying = false;
                await reply(message, st === 'failed' ? `⚠️ اتوقف بث **${res.title}** بسبب ضغط على سيرفر الفيديو — جرّب تاني بعد دقيقة.` : `⏹️ انتهى بث **${res.title}**`);
            } catch (e) {
                isPlaying = false;
                console.error('[VK] movie error:', e.message);
                return reply(message, '❌ فشل استخراج البث.');
            }
        }

        if (message.content === '!next' && lastSeriesCtx) {
            const nx = { ...lastSeriesCtx, e: lastSeriesCtx.e + 1 };
            if (isPlaying || placeholderProc) {
                trKill();
                await stopPlaying(message);
                await new Promise(r => setTimeout(r, 1200));
            }
            await reply(message, `⏭️ تشغيل الحلقة التالية — S${nx.s}E${nx.e}...`);
            message.content = `!playseries ${nx.id} ${nx.s} ${nx.e}`;
        }

        if (message.content.startsWith('!playseries ') || message.content.startsWith('!بثمسلسل ')) {
            const rawParts = message.content.split(' ').slice(1);
            if (!rawParts.length) return reply(message, '❌ الاستخدام:\n`!playseries ted lasso` موسم 1 حلقة 1\n`!playseries ted lasso 2 5`\n`!playseries 97546 2 5` بالـID');
            let s = parseInt(rawParts[1], 10) || 1;
            let e = parseInt(rawParts[2], 10) || 1;
            let idStr = rawParts.join(' ');
            let preTitle = '';
            if (!/^\d+$/.test(rawParts[0])) {
                const toks = [...rawParts];
                const tailNums = [];
                while (tailNums.length < 2 && toks.length > 1 && /^\d+$/.test(toks[toks.length - 1])) {
                    tailNums.unshift(toks.pop());
                }
                const q = toks.join(' ');
                await reply(message, `🔎 جاري البحث عن **${q}**...`);
                const results = await tmdbSearch('tv', q);
                if (!results.length) return reply(message, `❌ ملقتش مسلسل باسم **${q}**`);
                idStr = String(results[0].id);
                preTitle = results[0].title || results[0].name || '';
                if (tailNums.length >= 1) s = tailNums[0];
                if (tailNums.length >= 2) e = tailNums[1];
                console.log(`[SERIES] "${q}" -> tmdb ${idStr} (${preTitle}) S${s}E${e}`);
            }
            const parts = [idStr];
            if (isPlaying) return reply(message, '❌ يوجد بث قيد التشغيل. استعمل `!stop` أولاً.');
            await reply(message, '🔍 جاري استخراج البث...');
            try {
                let res = null, best = null, provider = 'VL';
                const gotTv = await pickAcrossProviders('tv', parts[0], s, e);
                if (gotTv) { provider = gotTv.provider; res = gotTv.res; best = gotTv.best; }
                if (best && !res.title) res = { ...res, title: preTitle || 'المسلسل' };
                if (!best) {
                    await reply(message, '🧲 مفيش مصادر مباشرة — جاري تحميل نسخة تورنت للحلقة (قد تأخذ دقيقة)...');
                    const tr = await trSources('tv', parts[0], s, e);
                    if (!tr || !tr.sources.length) return reply(message, '❌ مفيش مصادر متاحة للحلقة دي حالياً. جرّب بعدين.');
                    provider = 'TR'; res = tr; best = vkPickBest(tr.sources, '720');
                }
                let subPathTv = null;
                activeSubSource = '';
                subPathTv = await subdlArabicSub('tv', parts[0], s, e);
                if (subPathTv) activeSubSource = 'subdl';
                if (!subPathTv && (provider === 'VL' || provider === 'ST') && res.subUrl) {
                    subPathTv = await vlFetchArabicSub(res.subUrl);
                    if (subPathTv) activeSubSource = 'vl';
                }
                if (!subPathTv) {
                    const alt = await vdArabicSub('tv', parts[0], s, e);
                    if (alt) { console.log('[SUBS] vdrk tv sub found'); subPathTv = await vlFetchArabicSub(alt); if (subPathTv) activeSubSource = 'vdrk'; }
                    else console.log('[SUBS] vdrk: no tv coverage for', parts[0]);
                }
                if (!subPathTv && provider === 'TR') { subPathTv = trArabicSrt(parts[0]); if (subPathTv) activeSubSource = 'tr'; }
                if (!subPathTv) { subPathTv = await osArabicSub('tv', parts[0], s, e); if (subPathTv) activeSubSource = 'os'; }
                if (!subPathTv && res.subUrl) {
                    console.log('[SUBS] last-resort: VL subs on', provider, 'video - auto-sync will calibrate');
                    subPathTv = await vlFetchArabicSub(res.subUrl);
                    if (subPathTv) activeSubSource = 'vl_fallback';
                }
                isPlaying = true;
                lastSeriesCtx = { id: parts[0], s, e };
                currentChannelName = res.title;
                await reply(message, `📺 جاري بث **${res.title}** — موسم ${s} • حلقة ${e} في الروم...${subPathTv ? ' 📝 بالترجمة العربية' : ''}`);
                console.log(`[${provider}] tv ${parts[0]} S${s}E${e} via ${best.server} ${best.quality}${subPathTv ? ' +subs' : ''}`);
                const rStateTv = { provider, idx: 1 };
                const refreshTv = makeCrossRefresh('tv', parts[0], s, e, rStateTv);
                activeProvider = provider;
        activeTmdbId = String(parts[0]);
        const st2 = await startYtStream([best], selectedQuality, message, res.title, refreshTv, subPathTv);
                vlCleanupSub(subPathTv);
                isPlaying = false;
                await reply(message, st2 === 'failed' ? `⚠️ اتوقف بث **${res.title}** بسبب ضغط على سيرفر الفيديو — جرّب تاني بعد دقيقة.` : `⏹️ انتهى بث **${res.title}** S${s}E${e}`);
            } catch (e2) {
                isPlaying = false;
                console.error('[VK] series error:', e2.message);
                return reply(message, '❌ فشل استخراج البث.');
            }
        }

        // ===== Playback controls =====
        function fmtDur(sec) {
            sec = Math.max(0, Math.floor(sec));
            const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
            return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
        }
        function playbackPos() {
            if (!mediaInfo || mediaInfo.live || !mediaInfo.runStartedAt) return null;
            const end = mediaInfo.paused && mediaInfo.pauseStartedAt ? mediaInfo.pauseStartedAt : Math.min(Date.now(), lastProgressAt || Date.now());
            return mediaInfo.offsetBase + Math.max(0, (end - mediaInfo.runStartedAt) / 1000);
        }
        async function cmdPause() {
            if (!isPlaying || !ffmpegProcess) return reply(message, '❌ مفيش حاجة شغالة دلوقتي.');
            if (isPaused) return reply(message, '⏸️ متوقف مؤقتاً بالفعل. اكتب `!resume` للتكملة.');
            try { ffmpegProcess.kill('SIGSTOP'); } catch (_) {}
            if (mediaBufferStream) { try { mediaBufferStream.pause(); } catch (_) {} }
            if (mediaInfo) { mediaInfo.paused = true; mediaInfo.pauseStartedAt = Date.now(); }
            isPaused = true;
            await reply(message, '⏸️ تم الإيقاف المؤقت — اكتب `!resume` للتكملة.');
        }
        async function cmdResume() {
            if (!isPlaying) return reply(message, '❌ مفيش حاجة شغالة دلوقتي.');
            if (!isPaused) return reply(message, '▶️ التشغيل شغال بالفعل.');
            if (mediaBufferStream) { try { mediaBufferStream.resume(); } catch (_) {} }
            try { if (ffmpegProcess) ffmpegProcess.kill('SIGCONT'); } catch (_) {}
            if (mediaInfo && mediaInfo.paused && mediaInfo.pauseStartedAt) {
                mediaInfo.runStartedAt += Date.now() - mediaInfo.pauseStartedAt;
                mediaInfo.paused = false;
                mediaInfo.pauseStartedAt = null;
                lastProgressAt = Date.now();
            }
            isPaused = false;
            await reply(message, '▶️ استكمال التشغيل.');
        }
        async function cmdSeek(delta, target) {
            if (!isPlaying) return reply(message, '❌ مفيش حاجة شغالة دلوقتي.');
            if (!mediaInfo || mediaInfo.live) return reply(message, '❌ التقديم والتنقل متاح لليوتيوب والأفلام والمسلسلات فقط — البث المباشر لا يدعمه.');
            const pos = playbackPos() || 0;
            let t;
            let label;
            if (target != null) {
                t = target; label = `🎯 الانتقال إلى \`${fmtDur(t)}\``;
            } else if (delta >= 0) {
                t = pos + delta; label = `⏩ تقديم ${delta} ثانية → \`${fmtDur(t)}\``;
            } else {
                t = Math.max(0, pos + delta); label = `⏪ رجوع ${Math.abs(delta)} ثانية → \`${fmtDur(t)}\``;
            }
            pendingSeek = Math.floor(t);
            if (isPaused) {
                isPaused = false;
                if (mediaInfo) { mediaInfo.paused = false; mediaInfo.pauseStartedAt = null; }
            }
            await reply(message, `${label} ...`);
            killFFmpeg();
        }

        if (/^!(pause|وقف|وقّف)$/.test(message.content)) {
            await cmdPause();
        }

        if (/^!(resume|كمّل|كمل|استكمال)$/.test(message.content)) {
            await cmdResume();
        }

        if (/^!fwd(\s+\d+)?$/.test(message.content) || /^!تقدم(\s+\d+)?$/.test(message.content)) {
            const n = parseInt(message.content.split(' ')[1], 10);
            await cmdSeek(isNaN(n) ? 10 : Math.min(n, 600), null);
        }

        if (/^!back(\s+\d+)?$/.test(message.content) || /^!رجوع(\s+\d+)?$/.test(message.content)) {
            const n = parseInt(message.content.split(' ')[1], 10);
            await cmdSeek(-(isNaN(n) ? 10 : Math.min(n, 600)), null);
        }

        if (/^!(subdelay|تأخيرترجمة)\s+[-+]?\d+/.test(message.content)) {
            if (!isPlaying || !mediaInfo || mediaInfo.live) return reply(message, '❌ متاح أثناء تشغيل فيلم/مسلسل فقط.');
            const n = parseInt(message.content.split(/\s+/)[1], 10);
            subDelayAdj = Math.max(-600, Math.min(600, n));
            if (activeTmdbId) { subSyncMem[activeTmdbId] = subDelayAdj; subMemSave(); }
            await reply(message, `📝 تأخير الترجمة = ${subDelayAdj > 0 ? '+' : ''}${subDelayAdj}ث — تم الحرق من جديد${activeTmdbId ? ' ✅ محفوظ تلقائيًا لهذا الفيلم للأبد' : ''}`);
            pendingSeek = Math.floor(playbackPos() || 0);
            killFFmpeg();
        }

        if (/^!(subdelay|تأخيرترجمة)$/.test(message.content)) {
            await reply(message, `📝 تأخير الترجمة الحالي: ${subDelayAdj > 0 ? '+' : ''}${subDelayAdj}ث\nالصيغة: \`!subdelay 5\` لتأخيرها 5 ثواني، \`!subdelay -3\` لتقديمها 3 ثواني`);
        }

        if (/^!(goto|seek)\s+\S+/.test(message.content)) {
            const arg = message.content.split(' ')[1];
            let t = null;
            if (/^\d+$/.test(arg)) t = parseInt(arg, 10);
            else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(arg)) {
                const p = arg.split(':').map(Number);
                t = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
            }
            if (t == null) return reply(message, '❌ الصيغة: `!goto 90` ثواني أو `!goto 3:25` دقيقة:ثانية');
            await cmdSeek(null, t);
        }

        if (/^!np$/.test(message.content) || /^!الآن$/.test(message.content)) {
            if (!isPlaying || !currentChannelName) return reply(message, '❌ مفيش حاجة شغالة دلوقتي.');
            const pos = playbackPos();
            let msg = `🎬 **يشتغل الآن:** ${currentChannelName}`;
            if (pos != null) msg += `\n⏱️ الموضع: \`${fmtDur(pos)}\``;
            if (isPaused) msg += '\n⏸️ الحالة: **متوقف مؤقتاً**';
            await reply(message, msg);
        }

        if (message.content === '!status' || message.content === '!حالة') {
            const bar = (v) => v >= PH_SKIP ? '⛔' : v === 0 ? '✅' : '🟡';
            const provs = ['VL', 'VK', 'CC', 'MG', 'ST'].map(p => `${bar(phVal(p))} ${p} — ${phVal(p) >= PH_SKIP ? 'متخطى مؤقتًا' : phVal(p) + ' أخطاء'}`).join('\n');
            const trLine = trActiveProc ? '⬇️ جاري تنزيل تورنت...' : '🧲 جاهز كاحتياطي';
            const playLine = isPlaying ? `▶️ ${currentChannelName || 'قناة'}${mediaInfo && !mediaInfo.live ? ` @ ${fmtDur(playbackPos() || 0)}` : ''}` : '⏹️ لا يوجد بث';
            await reply(message, `📊 **حالة النظام**\n\n**المزودون:**\n${provs}\n\n**البث:** ${playLine}\n**التورنت:** ${trLine}\n**الترجمة:** ${OPENSUB_API_KEY ? 'OpenSubtitles ✓' : 'vdrk فقط'}\n**الحلقة التالية:** ${lastSeriesCtx ? `S${lastSeriesCtx.s}E${lastSeriesCtx.e} جاهزة لـ!next` : '—'}`);
        }

        if (message.content === '!stop') {
            trKill();
            await stopPlaying(message);
        }

        if (message.content === '!txt') {
            const channels = await fetchChannels();
            if (!channels || Object.keys(channels).length === 0) return;
            const lines = Object.entries(channels).map(([num, ch]) => `${num}. ${ch.name}`);
            const filePath = path.join(__dirname, 'channels.txt');
            fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
            console.log(`✅ تم تصدير ${lines.length} قناة إلى ${filePath}`);
        }

        if (message.content.startsWith('!id ')) {
            const newId = message.content.split(' ')[1];
            if (!/^\d+$/.test(newId)) return reply(message, '❌ أدخل ID صحيح (أرقام فقط).');
            VOICE_ID = newId;
            await reply(message, `✅ ROM الصوتي: \`${VOICE_ID}\``);
        }

        if (message.content === '!id') {
            await reply(message, `📍 ROM الصوتي: \`${VOICE_ID}\`\n📍 السيرفر: \`${GUILD_ID}\``);
        }

        if (message.content.startsWith('!guildid ')) {
            const newId = message.content.split(' ')[1];
            if (!/^\d+$/.test(newId)) return reply(message, '❌ أدخل ID صحيح (أرقام فقط).');
            GUILD_ID = newId;
            await reply(message, `✅ السيرفر: \`${GUILD_ID}\``);
        }

        if (message.content === '!guildid') {
            await reply(message, `📍 السيرفر: \`${GUILD_ID}\``);
        }

        if (message.content === '!admins') {
            const list = OWNER_IDS.map((id, i) => `${i === 0 ? '👑' : '🛡️'} ${id}${id === MAIN_OWNER ? ' (المالك)' : ''}`).join('\n');
            await reply(message, `**المتحكمين:**\n${list}`);
        }

        if (message.content.startsWith('!addadmin ')) {
            if (message.author.id !== MAIN_OWNER) {
                return reply(message, '❌ فقط المالك الرئيسي يقدر يضيف متحكمين.');
            }
            const newId = message.content.split(' ')[1];
            if (!/^\d+$/.test(newId)) return reply(message, '❌ أدخل ID صحيح (أرقام فقط).');
            if (OWNER_IDS.includes(newId)) return reply(message, '❌ هذا المستخدم متحكم بالفعل.');
            OWNER_IDS.push(newId);
            await reply(message, `✅ تمت إضافة \`${newId}\` كمتحكم.`);
        }

        if (message.content.startsWith('!removeadmin ')) {
            if (message.author.id !== MAIN_OWNER) {
                return reply(message, '❌ فقط المالك الرئيسي يقدر يمسح متحكمين.');
            }
            const removeId = message.content.split(' ')[1];
            if (removeId === MAIN_OWNER) return reply(message, '❌ مش تقدر تمسح نفسك.');
            if (!OWNER_IDS.includes(removeId)) return reply(message, '❌ هذا المستخدم مش متحكم.');
            OWNER_IDS = OWNER_IDS.filter(id => id !== removeId);
            await reply(message, `✅ تمت إزالة \`${removeId}\` من المتحكمين.`);
        }

        if (message.content === '!cookies') {
            const exists = fs.existsSync(COOKIES_PATH);
            if (exists) {
                const stat = fs.statSync(COOKIES_PATH);
                const age = Math.floor((Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24));
                await reply(message, `✅ Cookies موجود (${stat.size} bytes, عمر ${age} يوم)`);
            } else {
                await reply(message, '❌ Cookies مش موجود.\nابعت ملف `cookies.txt` في الشات وأنا هحفظه.');
            }
        }

        if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            if (attachment.name && (attachment.name.includes('cookie'))) {
                try {
                    const response = await fetch(attachment.url);
                    const text = await response.text();
                    fs.writeFileSync(COOKIES_PATH, text, 'utf8');
                    await reply(message, `✅ تم حفظ cookies.txt (${text.length} bytes)`);
                    console.log(`[Cookies] Saved from attachment: ${attachment.name}`);
                } catch (e) {
                    await reply(message, `❌ فشل تحميل الملف: ${e.message}`);
                }
            }
        }

        if (message.content === '!help') {
            const helpTxt = [
                '🤖 **الأوامر:**',
                '',
                '**IPTV:**',
                '`!tv` - عرض قائمة القنوات',
                '`!play <رقم>` - تشغيل قناة IPTV',
                '',
                '**YouTube:**',
                '`!yt <رابط>` - تشغيل فيديو يوتيوب',
                '`!yt <رابط> 720p` - تشغيل بجودة محددة',
                '`!yts <كلمة>` - بحث في يوتيوب',
                '`!cookies` - حالة ملف الكوكيز',
                'ابعت ملف `cookies.txt` في الشات لتفعيل يوتيوب',
                '',
                '**عام:**',
                '`!stop` - إيقاف البث',
                '`!quality <جودة>` - ضبط جودة IPTV',
                '`!status` / `!حالة` - تقرير شامل: صحة المزودين + البث + التورنت',
                '`!id` / `!id <رقم>` - ROM الصوتي',
                '`!guildid` / `!guildid <رقم>` - السيرفر',
                '`!txt` - تصدير القنوات',
                '',
                '**إدارة المتحكمين (المالك فقط):**',
                '`!addadmin <id>` - إضافة متحكم',
                '`!removeadmin <id>` - مسح متحكم',
                '`!admins` - قائمة المتحكمين',
                '',
                '`!help` - المساعدة',
                '',
                '**الجودات:** 240p, 360p, 480p, 720p, 720pf, 1080p, 1440p, 4k, 8k',
                            '',
                '**🎬 أفلام ومسلسلات:**',
                '`!movie <اسم>` - بحث عن فيلم',
                '`!movie <id>` - تفاصيل + لينك مشاهدة',
                '`!series <اسم>` - بحث عن مسلسل',
                '`!series <id> <موسم> <حلقة>` - مشاهدة حلقة',
                '`!playmovie <اسم أو id>` - بث الفيلم في الروم الصوتي',
                '`!playseries <اسم أو id> [موسم] [حلقة]` - بث الحلقة في الروم',
                '`!next` - تشغيل الحلقة التالية فورًا',
                '',
                '📝 كل الأفلام والمسلسلات بتت بث **بالترجمة العربية تلقائيًا**',
                '🧲 لو المصادر المباشرة فشلت → تحميل تورنت تلقائي (أوعبة أمان)',
                '',
                '⏯️ **التحكم في التشغيل:**',
                '`!pause` - إيقاف مؤقت | `!resume` - استكمال',
                '`!fwd <ثواني>` - تقديم | `!back <ثواني>` - رجوع',
                '`!goto <دقيقة:ثانية>` - الانتقال لموضع محدد',
                '`!np` - ما يشتغل الآن',
].join('\n');
            await reply(message, helpTxt);
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            isPlaying = false;
            return;
        }
        console.error('Error:', err);
        isPlaying = false;
        try {
            await reply(message, `❌ خطأ: ${err.message || 'حدث خطأ غير متوقع'}`);
        } catch (_) {}
        killFFmpeg();
    try { streamer.stopStream(); } catch (_) {}
    try { stopPlaceholder(); } catch (_) {}
    try { streamer.leaveVoice(); } catch (_) {}
    }
});

client.login(TOKEN);
