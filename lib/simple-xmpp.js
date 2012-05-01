/**

 The MIT License

 Copyright (c) 2011 Arunoda Susiripala, modified by Joachim Kainz

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.

 */
(function (module) {
    "use strict";

    var reqNo = 0,
        DISCO_URL = 'http://jabber.org/protocol/disco#info',
        ROSTER_URN = 'jabber:iq:roster',
        xmpp = require('node-xmpp'),
        debug = require('./debug'),
        EventEmitter = require('events').EventEmitter,
        util = require('util');

    function makeId() {
        var id = ++reqNo;

        return "jolira_" + id;
    }
    function getState(stanza) {
        if (stanza.attrs.type === 'unavailable') {
            return stanza.attrs.type;
        }

        var show = stanza.getChild('show');

        if (!show) {
            return undefined;
        }

        return show.getText();
    }

    function processMessage(events, stanza) {
        if (stanza.attrs.type !== 'chat') {
            return;
        }

        var body = stanza.getChild('body');

        if (!body) {
            return;
        }

        var message = body.getText(),
            from = stanza.attrs.from,
            id = from.split('/')[0];

        events.emit('chat', id, message);
    }

    function processStanza(handlers, events, stanza) {
        events.emit('stanza', stanza);

        if (stanza.is('message')) {
            return processMessage(events, stanza);
        }

        if (!stanza.attrs.id) {
            if (!stanza.is('presence')) {
                return debug("tangling stanza", stanza);
            }
            return;
        }

        var handler = handlers[stanza.attrs.id];

        if (!handler) {
            return debug("unhandled stanza", stanza);
        }

        delete handlers[stanza.attrs.id];

        if (stanza.attrs.type === 'error') {
            return handler(stanza);
        }

        return handler(undefined, stanza);
    }

    function sendMessage(pending, connection) {
        var args = Array.prototype.splice.call(arguments, 2);

        if (pending) {
            return pending.push(args);
        }

        return xmpp.Client.prototype.send.apply(connection, args);
    }

    function processDisco(stanza) {
        var element = stanza.getChild('query', DISCO_URL),
            children = element.children,
            result = {
                features: {}
            };

        children.forEach(function(child){
            if (child.name === 'identity') {
                return result.identity = child.attrs;
            }
            else if (child.name == 'feature') {
                return result.features[child.attrs.var] = true;
            }
            else {
                debug("tangling disco entry", child);
            }
        });

        return result;
    }

    function processRoster(stanza) {
        var element = stanza.getChild('query', ROSTER_URN),
            result = [];

        element.children.forEach(function(child){
            result.push(child.attrs);
        });

        return result;
    }

    function SimpleXMPP(params) {
        EventEmitter.call(this);

        var connection,
            self = this,
            handlers = {},
            pending = [],
            config = {
                jid:new xmpp.JID(params.jid),
                password:params.password,
                host:params.host,
                port:params.port
            };

        function pushHandler(cb) {
            var id = makeId();

            handlers[id] = cb;

            return id;
        }

        process.nextTick(function () {
            connection = new xmpp.Client(config);
            connection.on('stanza', function (stanza) {
                processStanza(handlers, self, stanza);
            });

            connection.on('error', function (err) {
                debug("error", util.inspect(err, true, 100));
                self.emit('error', err);
            });

            connection.on('online', function () {
                sendMessage(pending, connection, new xmpp.Presence());
                self.emit('online');

                setInterval(function () {
                    sendMessage(pending, connection, new xmpp.Presence());
                }, config.presenceInterval || 15000);

                var queue = pending;
                pending = undefined;

                queue.forEach(function (msg) {
                    xmpp.Client.prototype.send.apply(connection, msg);
                });
            });

        });
        this.discoverServices = function (to, cb) {
            var id = pushHandler(function(err, stanza) {
                    if (err) {
                        return cb(err);
                    }

                    cb(undefined, processDisco(stanza));
                }),
                disco = new xmpp.Iq({
                    id: id,
                    type:'get',
                    to:to
                });

            disco.c('query', { xmlns:DISCO_URL });

            sendMessage(pending, connection, disco);

            /*
             var roster = new xmpp.Element('iq', {
             type: 'get',
             from: connection.jid.toString(),
             id: 'roster_1'
             }).c('query', { xmlns: 'jabber:iq:roster' });

             sendMessage(pending, connection, roster);
             */
        };
        this.send = function (to, message) {
            var stanza = new xmpp.Message({
                to:to,
                type:'chat'
            });
            stanza.c('body').t(message);

            sendMessage(pending, connection, stanza);
        };
        this.loadRoster = function (cb) {
            var id = pushHandler(function(err, result){
                    if (err) {
                        return cb(err);
                    }

                    return cb(undefined, processRoster(result));
                }),
                stanza = new xmpp.Iq({
                    id: id,
                    type:'get'
                });

            stanza.c('query', { xmlns:ROSTER_URN});

            return sendMessage(pending, connection, stanza);
        };
    }

    util.inherits(SimpleXMPP, EventEmitter);

    module.exports = function (config) {
        return new SimpleXMPP(config);
    };
})(module);