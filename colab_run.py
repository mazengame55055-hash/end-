import os, subprocess, time
os.environ['TOKEN'] = 'YOUR_TOKEN_HERE'
os.chdir('/content/end-')
while True:
    proc = subprocess.Popen(['node', 'index.js'], env={**os.environ})
    proc.wait()
    print(f'[CRASH] exited code={proc.returncode}, restarting in 3s...')
    time.sleep(3)
