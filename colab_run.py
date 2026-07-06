import os, subprocess, time, signal, sys

os.chdir('/content/end-')
TOKEN = os.environ.get('TOKEN') or sys.argv[1] if len(sys.argv) > 1 else None

if not TOKEN:
    print('ERROR: Set TOKEN env var or pass as argument')
    sys.exit(1)

env = {**os.environ, 'TOKEN': TOKEN}

def start_bot():
    return subprocess.Popen(
        ['node', 'index.js'],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

proc = start_bot()
print('Bot started. PID:', proc.pid)

try:
    while True:
        line = proc.stdout.readline()
        if line:
            print(line.decode().rstrip())
        if proc.poll() is not None:
            print(f'Bot exited (code={proc.returncode}), restarting in 3s...')
            proc.wait()
            time.sleep(3)
            proc = start_bot()
except KeyboardInterrupt:
    proc.kill()
    print('Stopped.')
