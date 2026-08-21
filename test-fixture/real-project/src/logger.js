const logs = [];
function log(msg) { logs.push({ msg, time: Date.now() }); return logs.length; }
function getLogs() { return [...logs]; }
function clear() { logs.length = 0; }
module.exports = { log, getLogs, clear };
