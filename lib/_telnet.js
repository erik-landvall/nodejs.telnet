const Debug = require('@superhero/debug');
module.exports = (options = {}) =>
{
  let
  // job queue
  queue  = [],
  // data buffer
  buffer = '';

  let ended = false;

  const
  onEnds  = [],
  bus     = new class extends require('events') {},
  telnet  = new require('net').Socket(),
  config  = Object.assign(
  {
    host        : '127.0.0.1',
    port        : 23,
    timeout     : 0,
    debug       : {},
    debug_level : 1,
    error       : [],
    end         : /# ?$/,
    onEnd       : undefined,
    onError     : undefined,
    onTimeout   : undefined
  }, options),
  // debugger tool, logs to the console if the config.debug is set to true..
  debug = new Debug(config.debug),
  // flush buffer to output
  flush = () =>
  {
    bus.emit('return', buffer);
    buffer = '';
  },
  // waits for data to match the next jobs regex..
  delegate = () =>
  {
    if(queue.length && config.error.some((regex) => buffer.match(regex)))
    {
      telnet.emit('error', 'error found in output:' + buffer);
      buffer = '';
    }
    else if(queue.length && buffer.match(queue[0].regex))
    {
      flush();
      bus.emit('ready');
    }
    else if(!queue.length && buffer.match(config.end))
    {
      ended = true;
      flush();
      onEnds.forEach((onEnd) => onEnd());
    }
    else
    {
      config.debug_level > 2 && bus.emit('return', buffer);
    }
  };

  // on ends observers
  config.onEnd && onEnds.push(config.onEnd);

  // forwarding error message, if one appear
  telnet.on('error', (error) =>
  {
    debug.log(`error: "${error}"`);
    config.onError && config.onError(error);
  });

  // trigger the "return" event before exiting, resetting the queue
  telnet.on('close', (...args) =>
  {
    config.debug_level > 1 && debug.log(`socket: "close", arguments: "${args}"`);
    queue = [];
    flush();
  });

  // routing incoming data
  telnet.on('data', (data) =>
  {
    buffer += data.toString().replace(/[\x00-\x09\x10-\x1F]/g, '');
    delegate();
  });

  // if a shell is prompted, then we are no longer processing a request. look
  // for a job in the queue to execute or open up to allow new commands to be
  // executed if no jobs are queued by deactivating the processing flag..
  bus.on('ready', () =>
  {
    const job = queue.shift();

    config.debug_level > 1 && debug.log(`executing: "${job.cmd}"`);
    // if a callaback for the command is specified to be called after the
    // command is completed
    job.callback && bus.once('return', (data) => job.callback(data));
    // executing the qued command
    setTimeout(
      () => telnet.write(job.cmd + '\n', () => config.debug_level > 2
                                            && debug.log(`executed: "${job.cmd}"`)),
      job.timeout || 0);
  });

  // adding debug observers for the socket events
  config.debug && ['connect','drain','error','lookup','end'].forEach((event) =>
    telnet.on(event, (...args) =>
      args.length
      ? config.debug_level > 2 && debug.log(`socket: "${event}", arguments: "${args}"`)
      : config.debug_level > 2 && debug.log(`socket: "${event}"`)));

  // adding debug observers for the socket "timeout" event
  config.debug && telnet.on('timeout', () =>
    debug.log(`socket: "timeout", buffer:\n${buffer}`));

  // hook possibility to the timeout event
  telnet.on('timeout', () =>
  {
    flush();
    config.onTimeout && config.onTimeout('timeout');
  });

  // adding debug observers for the module events
  config.debug && ['ready','error'].forEach((event) =>
    bus.on(event, (...args) =>
      args.length
      ? config.debug_level > 2 && debug.log(`module: "${event}", arguments: "${args}"`)
      : config.debug_level > 2 && debug.log(`module: "${event}"`)));

  // adding debug observers for the module "return" event
  config.debug
  && bus.on('return', (data) => debug.log(`module: "return":\n${data}`));

  // interface
  return new class
  {
    connect()
    {
      telnet.connect(config.port, config.host, () =>
      {
        debug.log(`connected to "${config.host}:${config.port}"`);
        debug.log(`set timeout to "${config.timeout}"`);
        telnet.setTimeout(config.timeout);
      });
      return this;
    }

    disconnect()
    {
      telnet.end();
    }

    onEnd(observer)
    {
      ended
      ? observer()
      : onEnds.push(observer);
    }

    exec(regex, cmd, timeout, callback)
    {
      queue.push({regex, cmd, timeout, callback});
      return this;
    }
  };
};