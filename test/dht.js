var assert = require('assert')
var EventEmitter = require('events').EventEmitter
var fs = require('fs')
var path = require('path')
var vm = require('vm')

function fixture(synchronous) {
  var now = 0, nextId = 0, timers = [], calls = [], client
  function schedule(fn, delay) {
    var timer = { id: ++nextId, at: now + delay, fn: fn, cancelled: false }
    timers.push(timer)
    return timer
  }
  function tick(ms) {
    var end = now + ms, next
    while ((next = timers.filter(function(t) {
      return !t.cancelled && t.at <= end
    }).sort(function(a, b) { return a.at - b.at || a.id - b.id })[0])) {
      next.cancelled = true
      now = next.at
      next.fn()
    }
    now = end
  }
  function Client() {
    client = this
    EventEmitter.call(this)
  }
  Client.prototype = Object.create(EventEmitter.prototype)
  Client.prototype.lookup = function(hash, callback) {
    var call = { hash: hash, callback: callback, aborted: 0 }
    calls.push(call)
    if (synchronous && callback) callback()
    return function() { call.aborted++ }
  }
  Client.prototype.destroy = function(callback) { if (callback) callback() }
  var module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dht.js'), 'utf8'), {
    module: module,
    require: function(name) { return name === 'bittorrent-dht' ? Client : require(name) },
    setTimeout: schedule,
    clearTimeout: function(timer) { timer.cancelled = true }
  }, { filename: 'dht.js' })
  var source = new module.exports('0000000000000000000000000000000000000001')
  source.numRequests = 0
  return { source: source, client: client, calls: calls, tick: tick }
}

function test(name, run) {
  try { run(); console.log('ok - ' + name) }
  catch (error) { process.exitCode = 1; console.error('not ok - ' + name); console.error(error.message) }
}

test('retry after lookup completes', function() {
  var f = fixture()
  f.source.run(); f.tick(1500)
  assert.strictEqual(f.calls.length, 1)
  f.calls[0].callback()
  f.source.run(); f.tick(1500)
  assert.strictEqual(f.calls.length, 2)
  assert.strictEqual(f.source.numRequests, 2)
})

test('run does not start duplicate lookups', function() {
  var f = fixture()
  f.source.run(); f.source.run(); f.tick(1500)
  f.source.run(); f.tick(30000)
  assert.strictEqual(f.calls.length, 1)
})

test('old callback does not clear a newer lookup', function() {
  var f = fixture()
  f.source.run(); f.tick(1500)
  f.source.pause(); f.source.run(); f.tick(1500)
  assert.strictEqual(f.calls[0].aborted, 1)
  assert.strictEqual(f.calls.length, 2)
  f.calls[0].callback()
  f.source.run(); f.tick(1500)
  assert.strictEqual(f.calls.length, 2)
  f.calls[1].callback()
  f.source.run(); f.tick(1500)
  assert.strictEqual(f.calls.length, 3)
})

test('retry after synchronous completion', function() {
  var f = fixture(true)
  f.source.run(); f.tick(1500)
  f.source.run(); f.tick(1500)
  assert.strictEqual(f.calls.length, 2)
})

test('pause cancels a pending lookup', function() {
  var f = fixture()
  f.source.run(); f.source.pause(); f.tick(1500)
  assert.strictEqual(f.calls.length, 0)
  f.source.run(); f.tick(1500)
  assert.strictEqual(f.calls.length, 1)
})
