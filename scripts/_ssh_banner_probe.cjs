// Сырое чтение SSH-баннера сервера без ssh-клиента (диагностика VPN/локального пути).
const net = require('node:net');
const HOST = process.argv[2] || '95.85.241.121';
const PORT = Number(process.argv[3] || 22);

const sock = net.connect({ host: HOST, port: PORT, timeout: 12000 });
sock.setTimeout(12000);
let sawData = null;
sock.on('connect', () => console.log(`[tcp] connected to ${HOST}:${PORT}`));
sock.on('data', (buf) => {
  if (!sawData) {
    sawData = buf;
    console.log(`[tcp] FIRST DATA (${buf.length}B):`);
    console.log(buf.toString('utf8').replace(/\r/g, '\\r').replace(/\n/g, '\\n').slice(0, 200));
    console.log('hex:', buf.slice(0, 32).toString('hex'));
  }
  sock.end();
});
sock.on('timeout', () => { console.log('[tcp] TIMEOUT — сервер ничего не прислал за 12s (banner dead)'); sock.destroy(); process.exitCode = 2; });
sock.on('error', (e) => { console.log('[tcp] ERR', e.message); process.exitCode = 1; setTimeout(() => process.exit(1), 100); });
sock.on('close', () => {
  console.log(sawData ? '[tcp] banner получен: SSH транспорт жив' : '[tcp] close без данных');
  if (sawData) process.exit(0); else process.exit(1);
});