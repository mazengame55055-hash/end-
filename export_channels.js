
const fs = require('fs');
const IPTV = {
    host: process.env.IPTV_HOST || 'http://ugeen.live',
    port: process.env.IPTV_PORT || '8080',
    user: process.env.IPTV_USER || 'Ugeen_VIP1pjmEs',
    pass: process.env.IPTV_PASS || 'v0CvBh',
};
const M3U_URL = `${IPTV.host}:${IPTV.port}/get.php?username=${IPTV.user}&password=${IPTV.pass}&type=m3u_plus&output=ts`;
function parseM3U(m3uText) {
    const channels = {};
    const lines = m3uText.split('\n');
    let index = 1;
    let currentName = null;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#EXTINF:')) {
            const nameMatch = trimmed.match(/tvg-name="([^"]*)"/) || trimmed.match(/,([^,]+)$/);
            if (nameMatch) currentName = nameMatch[1].trim();
        } else if (trimmed.startsWith('http') && currentName) {
            channels[String(index)] = { name: currentName, url: trimmed };
            index++;
            currentName = null;
        }
    }
    return channels;
}
(async () => {
    const res = await fetch(M3U_URL);
    const text = await res.text();
    const channels = parseM3U(text);
    const out = Object.entries(channels).map(([n, c]) => `${n}. ${c.name}`).join('\n');
    fs.writeFileSync(__dirname + '/channels.txt', out + '\n', 'utf8');
    console.log('TOTAL=' + Object.keys(channels).length);
})();
