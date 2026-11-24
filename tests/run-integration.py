"""Run the API suite on fresh, isolated local D1/R2 state. No remote resources."""
import json, os, pathlib, secrets, signal, subprocess, tempfile, time, urllib.request, urllib.error
root=pathlib.Path(__file__).resolve().parents[1]
(root/'.wrangler').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='integration-',dir=root/'.wrangler') as directory:
    folder=pathlib.Path(directory)
    config=json.loads((root/'wrangler.jsonc').read_text())
    config.pop('account_id',None)
    config['main']=str(root/'worker/index.ts')
    config['assets']['directory']=str(root/'dist')
    config['d1_databases'][0]['migrations_dir']=str(root/'migrations')
    config['d1_databases'][0]['database_id']='local-integration'
    # The suite makes more than 30 requests in a minute; production config is unchanged.
    config['ratelimits'][0]['simple']['limit']=1000
    config_path=folder/'wrangler.json'
    config_path.write_text(json.dumps(config))
    secret_path=folder/'.dev.vars'
    secret_path.write_text('BOOTSTRAP_SECRET='+secrets.token_hex(32)+'\n')
    wrangler=[str(root/'node_modules/.bin/wrangler')]
    shared=['--config',str(config_path),'--persist-to',str(folder/'state')]
    subprocess.run(wrangler+['d1','migrations','apply','topfast-helpdesk','--local']+shared,cwd=root,check=True)
    # Use an ephemeral loopback port without stopping any existing service.
    import socket
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    with (folder/'worker.log').open('w') as log:
        server=subprocess.Popen(wrangler+['dev','--ip','127.0.0.1','--port',str(port)]+shared,cwd=root,stdout=log,stderr=log,start_new_session=True)
        try:
            base=f'http://127.0.0.1:{port}/api'
            deadline=time.monotonic()+45
            while True:
                if server.poll() is not None:raise RuntimeError('Local Worker exited before readiness')
                try:
                    urllib.request.urlopen(base+'/me',timeout=1)
                except urllib.error.HTTPError as e:
                    if e.code==401:break
                except urllib.error.URLError:pass
                if time.monotonic()>deadline:raise RuntimeError('Local Worker did not become ready')
                time.sleep(.25)
            env={**os.environ,'TEST_BASE_URL':base,'TEST_SECRET_PATH':str(secret_path)}
            subprocess.run(['python3',str(root/'tests/integration.py')],cwd=root,env=env,check=True)
        finally:
            os.killpg(server.pid,signal.SIGTERM)
            try:server.wait(timeout=10)
            except subprocess.TimeoutExpired:os.killpg(server.pid,signal.SIGKILL);server.wait()
