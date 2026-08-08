#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lampa-token-sniff.py — захват токенов/авторизации Lampa (CUB + провайдеры)
с СОБСТВЕННОГО браузера и аккаунта. Только stdlib, никаких pip-пакетов.

Что делает
----------
1. Сам запускает Chrome/Chromium с --remote-debugging-port и ОТДЕЛЬНЫМ профилем
   (~/.lampa-cub-sniff-profile — сессии сохраняются между запусками).
2. Подключается по протоколу Chrome DevTools (CDP) через WebSocket (чистый python).
3. Читает localStorage страницы lampa.mx (там реально живёт CUB-токен сессии)
   и помечает значения, похожие на токены (JWT / base64 / mo-* / длинные строки).
4. Включает Network и в реальном времени печатает заголовки запросов,
   где есть authorization/cookie/token — к cub.rip, kodik, rezka, filmix и т.п.
5. Ты в открытом окне браузера нажимаешь «Открыть онлайн» на любом фильме —
   скрипт печатает authorization/cookie этого запроса.

Запуск:
    python3 lampa-token-sniff.py                 # обычный режим (ручной вход в CUB)
    python3 lampa-token-sniff.py --seconds 90
    python3 lampa-token-sniff.py --chrome-path /usr/bin/chromium --headless
    python3 lampa-token-sniff.py --auto --seconds 8    # без ручных пауз (проверка)

Вывод: cub-localstorage.json (все ключи localStorage) + найденные токены на экране.
НЕ заливайте cub-localstorage.json в git — там сессии личных аккаунтов.
Требование: установленный Google Chrome или Chromium.
"""

import argparse
import base64
import json
import os
import shutil
import socket
import ssl
import struct
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

CDP_HOST = "127.0.0.1"
DEFAULT_PORT = 9222

# Хосты, чьи запросы (и любые с authorization/cookie) нас интересуют.
TARGET_HOSTS = [
    "cub.rip", "lampa.mx", "tmdb", "kodik", "rezka", "filmix",
    "voidboost", "alloha", "hdvb", "cdnvideohub", "rutube", "kinopoisk",
]
AUTH_HEADERS = ["authorization", "cookie", "x-token", "token",
                "access-token", "api-key", "x-api-key", "apikey", "x-access-token"]


def log(msg):
    print(msg, flush=True)


# ------------------------------------------------------------------ WebSocket (stdlib)
class WebSocket:
    def __init__(self, host, port, path, tls=False, timeout=8):
        self._buf = b""
        self._raw = socket.create_connection((host, port), timeout=timeout)
        if tls:
            ctx = ssl.create_default_context()
            self._raw = ctx.wrap_socket(self._raw, server_hostname=host)

        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            "GET %s HTTP/1.1\r\n"
            "Host: %s:%d\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n" % (path, host, port)
        )
        self._raw.sendall(req.encode())
        head = self._read_http_head()
        if not head.startswith(("HTTP/1.1 101", "HTTP/1.0 101")):
            raise RuntimeError("WebSocket handshake failed:\n" + head)

    def _read_http_head(self):
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self._raw.recv(4096)
            if not chunk:
                break
            buf += chunk
        idx = buf.find(b"\r\n\r\n") + 4
        self._buf = buf[idx:]
        return buf[:idx].decode(errors="replace")

    def _recv_exact(self, n):
        while len(self._buf) < n:
            chunk = self._raw.recv(4096)
            if not chunk:
                raise ConnectionError("ws closed by peer")
            self._buf += chunk
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def send_text(self, text):
        self._send_frame(text.encode("utf-8"), 0x1)

    def _send_frame(self, payload, opcode):
        mask = os.urandom(4)
        head = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127)
            head += struct.pack(">Q", n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self._raw.sendall(bytes(head) + mask + masked)

    def recv_frame(self):
        """Возвращает (opcode, payload) одного кадра (только FIN, Chrome шлёт целые)."""
        h0, h1 = self._recv_exact(2)
        opcode = h0 & 0x0F
        fin = h0 & 0x80
        plen = h1 & 0x7F
        if plen == 126:
            plen = struct.unpack(">H", self._recv_exact(2))[0]
        elif plen == 127:
            plen = struct.unpack(">Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if (h1 & 0x80) else None
        payload = self._recv_exact(plen)
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        if not fin:
            raise IOError("fragmented ws frame not supported")
        return opcode, payload

    def close(self):
        try:
            self._raw.close()
        except Exception:
            pass


# ------------------------------------------------------------------ CDP сессия
class CDP:
    def __init__(self, ws):
        self.ws = ws
        self._seq = 0
        self._lock = threading.Lock()
        self._responders = {}
        self.events = []
        self._ev_lock = threading.Lock()
        self._reader = threading.Thread(target=self._readloop, daemon=True)

    def start(self):
        self._reader.start()

    def _readloop(self):
        while True:
            try:
                op, payload = self.ws.recv_frame()
            except Exception:
                break
            if op == 0x8:  # close frame
                break
            if op not in (0x1, 0x2):  # ping/pong-ish — пропуск
                continue
            try:
                msg = json.loads(payload.decode("utf-8", "replace"))
            except Exception:
                continue
            if msg.get("id") is not None:
                with self._lock:
                    cb = self._responders.pop(msg["id"], None)
                    if cb:
                        cb(msg)
            elif msg.get("method"):
                with self._ev_lock:
                    self.events.append(msg)

    def call(self, method, params=None):
        with self._lock:
            self._seq += 1
            mid = self._seq
        box = {}

        def done(msg):
            box["msg"] = msg

        with self._lock:
            self._responders[mid] = done
        self.ws.send_text(json.dumps({"id": mid, "method": method,
                                      "params": params or {}}))
        deadline = time.time() + 15
        while "msg" not in box:
            if time.time() > deadline:
                raise TimeoutError("CDP timeout: %s" % method)
            time.sleep(0.01)
        msg = box["msg"]
        if "error" in msg:
            raise RuntimeError("CDP error %s: %s" % (method, msg["error"]))
        return msg.get("result", {})


# ------------------------------------------------------------------ браузер
CHROME_CANDIDATES = [
    # Linux/macOS
    "google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
    "/opt/google/chrome/chrome", "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    # Windows
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def find_chrome():
    for name in CHROME_CANDIDATES:
        p = shutil.which(name)
        if p:
            return p
        if os.path.exists(name):
            return name
    return None


def endpoint_ready(port):
    try:
        with urllib.request.urlopen("http://%s:%d/json/version" % (CDP_HOST, port), timeout=2) as r:
            return bool(r.read(8))
    except Exception:
        return False


def start_browser(chrome, port, headless, profile_dir, url):
    cmd = [
        chrome,
        "--remote-debugging-port=%d" % port,
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-session-crashed-bubble",
        "--disable-gpu",
        "--user-data-dir=" + profile_dir,
        "--window-size=1280,860",
    ]
    if headless:
        cmd.append("--headless=new")
    cmd.append(url)
    log("[2] Запускаю Chrome (порт %d, headless=%s)…" % (port, headless))
    devnull = open(os.devnull, "w")
    return subprocess.Popen(cmd, stdout=devnull, stderr=devnull)


def open_or_wait_tab(port, url):
    """Открыть вкладку url. Возвращает (ws_url, title)."""
    end = time.time() + 45
    while time.time() < end:
        try:
            target_path = "/json/new?%s" % urllib.parse.quote(url, safe="")
            req = urllib.request.Request("http://%s:%d%s" % (CDP_HOST, port, target_path),
                                         method="PUT")
            with urllib.request.urlopen(req, timeout=3) as r:
                tgt = json.loads(r.read().decode())
                if tgt.get("webSocketDebuggerUrl"):
                    return tgt["webSocketDebuggerUrl"], tgt.get("title", "")
        except Exception:
            pass
        time.sleep(0.7)
    # запасной вариант: прицепиться к первой попавшейся вкладке
    try:
        with urllib.request.urlopen("http://%s:%d/json" % (CDP_HOST, port), timeout=3) as r:
            for t in json.loads(r.read().decode()):
                if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                    return t["webSocketDebuggerUrl"], t.get("title", "")
    except Exception:
        pass
    raise RuntimeError("Не удалось открыть вкладку (порт %d)" % port)


# ------------------------------------------------------------------ helpers
def looks_like_token(v):
    if not v or not isinstance(v, str) or len(v) < 12:
        return False
    v = v.strip()
    if any(c.isspace() for c in v):
        return False
    if v.startswith(("http://", "https://", "data:", "{")) \
            or v.startswith(("<!DOCTYPE", "<")):
        return False
    if "." in v and len(v) < 4000:  # JWT aaa.bbb.ccc
        return True
    if v.startswith(("mo-", "eyJ", "Bearer ", "bearer ")):
        return True
    body = v.replace("-", "").replace("_", "")
    return bool(body) and body.isalnum() and body.isprintable() and 16 <= len(body) <= 128


def mask_long(v, limit=120):
    if v is None:
        return ""
    v = str(v)
    return v if len(v) <= limit else v[:60] + "…(…%d…)" % (len(v) - 120)


def read_localstorage(cdp):
    js = (
        "(()=>{let err=null;const o={};try{"
        "for(let i=0;i<localStorage.length;i++){"
        "const k=localStorage.key(i);o[k]=localStorage.getItem(k);}}"
        "catch(e){err=String(e)}"
        "try{o['__cookie__']=document.cookie}catch(e){}"
        "if(err)o['__err__']=err;return o;})()"
    )
    r = cdp.call("Runtime.evaluate", {"expression": js, "returnByValue": True})
    val = (r.get("result") or {}).get("value")
    return val if isinstance(val, dict) else {}


def print_localstorage(findings):
    log("\n=== localStorage lampa.mx ===")
    if not findings or not any(not k.startswith("__") for k in findings):
        log("  (пусто или недоступен — откройте lampa.mx и залогиньтесь в CUB)")
        if findings.get("__err__"):
            log("  error: %s" % findings["__err__"])
        return
    for k in sorted(findings, key=lambda x: x.lower()):
        if k.startswith("__"):
            continue
        v = findings[k] or ""
        tag = "   <-- ВОЗМОЖНЫЙ ТОКЕН" if looks_like_token(v) else ""
        log("  %-28s = %s%s" % (k, mask_long(v), tag))
    if findings.get("__cookie__"):
        log("  document.cookie: %s" % mask_long(findings["__cookie__"], 300))
    try:
        with open("cub-localstorage.json", "w", encoding="utf-8") as fh:
            json.dump(findings, fh, ensure_ascii=False, indent=2)
        log("  (полный дамп: cub-localstorage.json)")
    except Exception as e:
        log("  (не удалось сохранить файл: %s)" % e)


def watch_network(cdp, seconds):
    end = time.time() + seconds
    printed = 0
    while time.time() < end:
        try:
            with cdp._ev_lock:
                msgs = list(cdp.events)
                del cdp.events[:]
            for msg in msgs:
                m = msg.get("method")
                params = msg.get("params") or {}
                if m == "Network.requestWillBeSent":
                    req = params.get("request") or {}
                    url = req.get("url") or ""
                    hdrs = {str(k).lower(): str(v)
                            for k, v in (req.get("headers") or {}).items()}
                    auth = ""
                    if "authorization" in hdrs:
                        auth += "authorization=" + mask_long(hdrs["authorization"]) + " "
                    if "cookie" in hdrs and ("cub" in url or "lampa" in url):
                        auth += "cookie=" + mask_long(hdrs["cookie"], 300) + " "
                    for k in AUTH_HEADERS:
                        if k in ("authorization", "cookie"):
                            continue
                        if k in hdrs:
                            auth += "[%s]=%s " % (k, mask_long(hdrs[k]))
                    if auth or any(h in url for h in TARGET_HOSTS):
                        printed += 1
                        log("REQ %s %s%s" % (params.get("type", ""), auth, url))
                elif m == "Network.responseReceived":
                    resp = params.get("response") or {}
                    sh = {str(k).lower(): str(v)
                          for k, v in (resp.get("headers") or {}).items()}
                    for k in ("set-cookie", "set-cookie2"):
                        if k in sh:
                            printed += 1
                            log("SET-COOKIE %s -> %s" % (params.get("url", ""),
                                                         mask_long(sh[k], 300)))
        except Exception as e:
            log("(net) %s" % e)
        time.sleep(0.15)
    log("  …обработано записей сети: %d" % printed)


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description="Захват токенов Lampa/CUB со своего браузера")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--url", default="https://lampa.mx")
    ap.add_argument("--chrome-path", default=None)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--auto", action="store_true",
                    help="без ручных пауз (для проверки из скрипта/СI)")
    ap.add_argument("--seconds", type=int, default=45,
                    help="сколько секунд слушать сеть после запуска")
    args = ap.parse_args()

    if not args.headless and os.name != "nt" and not os.environ.get("DISPLAY"):
        args.headless = True
        log("(нет DISPLAY — включаю headless; войти в CUB можно через уже готовый профиль)")

    chrome = args.chrome_path or find_chrome()
    if not chrome:
        sys.exit("Chrome/Chromium не найден. Укажи --chrome-path /usr/bin/chromium")

    profile = os.path.join(os.path.expanduser("~"), ".lampa-cub-sniff-profile")
    os.makedirs(profile, exist_ok=True)

    if endpoint_ready(args.port):
        log("[0] На порту %d уже есть Chrome (debug) — цепляемся к нему." % args.port)
        proc = None
    else:
        proc = start_browser(chrome, args.port, args.headless, profile, args.url)

    try:
        ws_url, title = open_or_wait_tab(args.port, args.url)
    except Exception as e:
        log("FATAL: %s" % e)
        if proc:
            proc.terminate()
        sys.exit(1)
    log("[1] Вкладка открыта: %s (title=%s)" % (args.url, title))

    up = urllib.parse.urlsplit(ws_url)
    ws = WebSocket(up.hostname or CDP_HOST, up.port or args.port, up.path,
                   tls=up.scheme == "wss")
    cdp = CDP(ws)
    cdp.start()

    try:
        cdp.call("Network.enable")
    except Exception as e:
        log("(Network.enable сбой: %s)" % e)
    try:
        cdp.call("Runtime.enable")
    except Exception:
        pass
    time.sleep(2)

    if args.auto:
        log("[2] auto: слушаю %d сек…" % args.seconds)
    else:
        log("\n[2] Браузер открыт. Если ещё не залогинен в CUB — сделайте это.")
        log("    Затем ОТКРОЙТЕ ЛЮБОЙ ФИЛЬМ (кнопка «Открыть»)\n"
            "    в окне браузера — я уже всё пишу.\n")
        print_localstorage(read_localstorage(cdp))
        try:
            input("    <Enter> — перейти к сводке (браузер останется открытым)…")
        except EOFError:
            pass

    print_localstorage(read_localstorage(cdp))

    log("[3] Слушаю сеть %d сек (Authorization/Cookie/SET-COOKIE):" % args.seconds)
    watch_network(cdp, args.seconds)
    log("[4] Готово.\n"
        "   - Файл: cub-localstorage.json (ВСЁ из localStorage, в текущей папке).\n"
        "   - Токены ищи по строкам 'ack…', 'authorization=', 'cookie=', 'SET-COOKIE='.\n"
        "   - НЕ коммить cub-localstorage.json в git.")
    ws.close()
    if proc:
        proc.terminate()
    sys.exit(0)


if __name__ == "__main__":
    main()