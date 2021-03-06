const path = require('path');
const { spawn } = require('child_process');
const ns = require('node-stream');
const unstyle = require('unstyle');
const touch = require('touch');

describe('integration', () => {
  const cwd = path.resolve(__dirname, '../fixtures');
  const cli = path.resolve(__dirname, '../bin/cli.js');
  let app;

  const wrap = stream => {
    return stream
      .pipe(unstyle())
      .pipe(ns.split())
      .pipe(ns.map(s => s.trim()));
  };

  const collect = stream => {
    const lines = [];

    stream._getLines = () => [].concat(lines);
    stream.on('data', line => lines.push(line));
    stream.pause();

    return stream;
  };

  const waitFor = (stream, regex) => {
    return new Promise(resolve => {
      const onReadable = () => {
        stream.resume();
      };

      const onLine = line => {
        stream.pause();

        if (regex.test(line)) {
          stream.removeListener('readable', onReadable);
          stream.removeListener('data', onLine);
          return resolve();
        }

        stream.resume();
      };

      stream.on('readable', onReadable);
      stream.on('data', onLine);
      stream.resume();
    });
  };

  const ready = stream => {
    return Promise.all([
      waitFor(stream, /main window open/),
      waitFor(stream, /watching new file: main\.js/),
      waitFor(stream, /watching new file: renderer\.js/),
      waitFor(stream, /watching new file: index\.html/)
    ]);
  };

  const file = fixturename => {
    return path.resolve(__dirname, '../fixtures', fixturename);
  };

  afterEach(async () => {
    if (!app) {
      return;
    }

    await new Promise(resolve => {
      app.once('exit', () => resolve());

      // destroying the io is necessary on linux and osx
      app.stdout.destroy();
      app.stderr.destroy();

      app.kill();
    });
  });

  it('watches files for restarts or refreshes', async () => {
    app = spawn(process.execPath, [
      cli,
      'main.js'
    ], {
      env: Object.assign({}, process.env, {
        ELECTRONMON_LOGLEVEL: 'verbose'
      }),
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const stdout = collect(wrap(app.stdout));

    await ready(stdout);

    await Promise.all([
      waitFor(stdout, /renderer file change: index\.html/),
      touch(file('index.html'))
    ]);

    await Promise.all([
      waitFor(stdout, /renderer file change: renderer\.js/),
      touch(file('renderer.js'))
    ]);

    await Promise.all([
      waitFor(stdout, /main file change: main\.js/),
      waitFor(stdout, /restarting app due to file change/),
      waitFor(stdout, /main window open/),
      touch(file('main.js'))
    ]);
  });

  if (process.platform === 'win32') {
    it('restarts apps on a change after they crash and the dialog is still open', async () => {
      app = spawn(process.execPath, [
        cli,
        'main.js'
      ], {
        env: Object.assign({}, process.env, {
          ELECTRONMON_LOGLEVEL: 'verbose',
          TEST_ERROR: 'pineapples'
        }),
        cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const stdout = collect(wrap(app.stdout));

      await waitFor(stdout, /pineapples/);
      await waitFor(stdout, /waiting for any change to restart the app/);

      await Promise.all([
        waitFor(stdout, /file change: main\.js/),
        waitFor(stdout, /pineapples/),
        waitFor(stdout, /waiting for any change to restart the app/),
        touch(file('main.js'))
      ]);

      await Promise.all([
        waitFor(stdout, /file change: renderer\.js/),
        waitFor(stdout, /pineapples/),
        waitFor(stdout, /waiting for any change to restart the app/),
        touch(file('renderer.js'))
      ]);
    });
  } else {
    it('restarts apps on a change after they crash at startup', async () => {
      app = spawn(process.execPath, [
        cli,
        'main.js'
      ], {
        env: Object.assign({}, process.env, {
          ELECTRONMON_LOGLEVEL: 'verbose',
          TEST_ERROR: 'pineapples'
        }),
        cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const stdout = collect(wrap(app.stdout));

      await waitFor(stdout, /uncaught exception occured/),
      await waitFor(stdout, /waiting for any change to restart the app/);

      await Promise.all([
        waitFor(stdout, /file change: main\.js/),
        waitFor(stdout, /uncaught exception occured/),
        waitFor(stdout, /waiting for any change to restart the app/),
        touch(file('main.js'))
      ]);

      await Promise.all([
        waitFor(stdout, /file change: renderer\.js/),
        waitFor(stdout, /uncaught exception occured/),
        waitFor(stdout, /waiting for any change to restart the app/),
        touch(file('renderer.js'))
      ]);
    });
  }
});
