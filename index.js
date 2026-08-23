process.on('uncaughtException', e => console.error('[CRASH]', e));
process.on('unhandledRejection', e => console.error('[CRASH]', e));

const fs = require('fs');
const path = require('path');
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
const { Streamer, playStream } = require('@dank074/discord-video-stream');
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
const streamer = new Streamer(client);

async function reply(msg, text) {
    try { await msg.reply(text); } catch (e) { console.log('[reply blocked]', e.message); }
}

const TOKEN = process.env.TOKEN;
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
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;
const RECONNECT_DELAY = 3000;

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
}

async function stopPlaying(message) {
    const name = currentChannelName || '';
    reconnectAttempts = MAX_RECONNECT;
    killFFmpeg();
    try { streamer.stopStream(); } catch (_) {}
    try { streamer.leaveVoice(); } catch (_) {}
    if (abortController) {
        try { abortController.abort(); } catch (_) {}
        abortController = null;
    }
    currentChannelName = null;
    isPlaying = false;
    if (message) await reply(message, `🛑 تم إيقاف **${name}** ومغادرة الروم.`);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function joinVoiceSafe() {
    if (streamer.voiceConnection) return;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await Promise.race([
                streamer.joinVoice(GUILD_ID, VOICE_ID),
                sleep(15000).then(() => { throw new Error('join timeout'); }),
            ]);
            console.log('[Voice] Joined voice channel');
            return;
        } catch (e) {
            console.error(`[Voice] join failed (try ${attempt}/3): ${e.message}`);
            try { streamer.leaveVoice(); } catch (_) {}
            try { streamer.stopStream(); } catch (_) {}
            await sleep(2500);
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

    while (reconnectAttempts < MAX_RECONNECT) {
        if (!isPlaying) break;

        console.log(`[Stream] Starting: ${channel.name} (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT})`);

        try {
            if (!streamer.voiceConnection) {
                await streamer.joinVoice(GUILD_ID, VOICE_ID);
                console.log('[Stream] Joined voice channel');
            }
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

                const bufferStream = new PassThrough({ highWaterMark: 1024 * 1024 * 16 });
                bufferStream.on('error', () => {});
                ffmpegProcess.stdout.pipe(bufferStream);

                playStream(bufferStream, streamer, {
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
    return j.results || [];
}

function vkMovieUrl(id) {
    return `https://www.vidking.net/embed/movie/${id}?color=${VIDKING_COLOR}&autoPlay=true`;
}

function vkTvUrl(id, s, e) {
    return `https://www.vidking.net/embed/tv/${id}/${s}/${e}?color=${VIDKING_COLOR}&autoPlay=true&nextEpisode=true&episodeSelector=true`;
}

function fmtTmdbLine(x) {
    const t = x.title || x.name || '?';
    const y = (x.release_date || x.first_air_date || '').slice(0, 4);
    const r = x.vote_average ? `⭐${x.vote_average.toFixed(1)}` : '';
    return `**${t}** ${y ? `(${y})` : ''} ${r} \`${x.id}\``;
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

async function startYtStream(urls, quality, message, title) {
    const urlList = Array.isArray(urls) ? urls.filter(Boolean) : [urls];
    const videoUrl = urlList[0];
    const audioUrl = urlList[1] || null;
    reconnectAttempts = 0;
    const { width, height, fps, bitrate, maxrate, bufsize } = quality;

    while (reconnectAttempts < MAX_RECONNECT) {
        if (!isPlaying) break;

        console.log(`[YT] Starting: ${title} (attempt ${reconnectAttempts + 1})`);

            try {
                await joinVoiceSafe();
            } catch (e) {
                isPlaying = false;
                return reply(message, `❌ فشل دخول الروم: ${e.message}`);
            }

        try {
            await new Promise((resolve, reject) => {
                const mkInput = (u) => [
                    '-reconnect', '1',
                    '-reconnect_streamed', '1',
                    '-reconnect_delay_max', '5',
                    '-reconnect_on_network_error', '1',
                    '-rw_timeout', '10000000',
                    '-analyzeduration', '2000000',
                    '-probesize', '10000000',
                    '-thread_queue_size', '8192',
                    '-i', u,
                ];
                const inputArgs = audioUrl
                    ? [...mkInput(videoUrl), ...mkInput(audioUrl)]
                    : mkInput(videoUrl);
                const args = [
                    '-hide_banner', '-loglevel', 'warning',
                    ...inputArgs,
                    '-fflags', '+genpts+discardcorrupt+nobuffer',
                    '-flags', '+low_delay+global_header',
                    '-max_muxing_queue_size', '4096',
                    ...(audioUrl ? ['-map', '0:v:0', '-map', '1:a:0', '-shortest'] : []),
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

                let stderrLog = '';
                ffmpegProcess.stderr.on('data', (c) => { stderrLog += c.toString(); });
                ffmpegProcess.stdout.on('error', () => {});
                ffmpegProcess.on('error', (err) => reject(err));
                ffmpegProcess.on('exit', (code, signal) => {
                    ffmpegProcess = null;
                    if (code !== 0 && code !== null && signal !== 'SIGKILL') {
                        reject(new Error(`FFmpeg exited code=${code}`));
                    } else {
                        resolve();
                    }
                });

                abortController = new AbortController();
                abortController.signal.addEventListener('abort', () => { killFFmpeg(); resolve(); });

                const bufferStream = new PassThrough({ highWaterMark: 1024 * 1024 * 16 });
                bufferStream.on('error', () => {});
                ffmpegProcess.stdout.pipe(bufferStream);

                playStream(bufferStream, streamer, {
                    type: 'go-live',
                    format: 'mpegts',
                    width: selectedQuality.width,
                    height: selectedQuality.height,
                    frameRate: selectedQuality.fps,
                }).then(() => resolve()).catch(reject);
            });
        } catch (err) {
            console.error(`[YT] Error: ${err.message}`);
        }

        killFFmpeg();
        if (!isPlaying) break;

        reconnectAttempts++;
        if (reconnectAttempts < MAX_RECONNECT) {
            await sleep(RECONNECT_DELAY);
        }
    }

    isPlaying = false;
    currentChannelName = null;
    killFFmpeg();
    try { streamer.stopStream(); } catch (_) {}
    try { streamer.leaveVoice(); } catch (_) {}
}

client.on('ready', async () => {
    console.log(`Logged in as: ${client.user.tag}`);
    console.log(`FFmpeg path: ${ffmpegPath || 'NOT FOUND'}`);
    await fetchChannels();
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

        if (message.content.startsWith('!tv ') || message.content.startsWith('!مسلسل ')) {
            const parts = message.content.split(' ').slice(1);
            if (!parts[0]) return reply(message, '❌ الاستخدام:\n`!tv بريكنج باد` للبحث\n`!tv 1396` للموسم 1 حلقة 1\n`!tv 1396 2 5` لموسم وحلقة محددة');
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
                    if (m.poster_path) msg += `\n\n${TMDB_IMG}${m.poster_path}`;
                    return reply(message, msg);
                }
                const query = parts.join(' ');
                const results = await tmdbSearch('tv', query);
                if (!results || results.length === 0) return reply(message, '❌ مفيش نتائج. جرّب اسم تاني.');
                const list = results.slice(0, 5).map((x) => `${fmtTmdbLine(x)}\n↳ تشغيل: \`!tv ${x.id}\``).join('\n');
                await reply(message, `📺 **نتائج البحث:**\n\n${list}`);
            } catch (err) {
                console.error('[TMDB] tv error:', err.message);
                return reply(message, '❌ حصل خطأ في البحث.');
            }
        }

        if (message.content === '!stop') {
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
                '`!status` - حالة البث',
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
            ].join('\n');
            await reply(message, helpTxt);
        }

        if (message.content === '!status') {
            const status = isPlaying
                ? `🎥 **يشتغل:** ${currentChannelName || 'قناة'}`
                : '🛑 **متوقف**';
            const quality = `📐 **الجودة:** ${selectedQuality.width}x${selectedQuality.height} @ ${selectedQuality.fps}fps (${selectedQuality.bitrate})`;
            await reply(message, `${status}\n${quality}`);
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
        try { streamer.leaveVoice(); } catch (_) {}
    }
});

client.login(TOKEN);
