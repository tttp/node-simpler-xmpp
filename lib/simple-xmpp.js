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

    var DISCO_URL = 'http://jabber.org/protocol/disco#info',
        xmpp = require('node-xmpp'),
        debug = require('./debug'),
        EventEmitter = require('events').EventEmitter,
        util = require('util');

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

    function processPresence(events, stanza, probeBuddies) {
        var frm = stanza.attrs.from;

        if (!frm) {
            return;
        }
        var iD = frm.split('/')[0],
            state = getState(stanza);

        debug('presence', iD, state);

        if (!probeBuddies[iD]) {
            return events.emit('buddy', iD, state);
        }

        events.emit('probe_' + iD, state);
        delete probeBuddies[iD];
    }

    function match(stanza, handler) {
        if (handler.matcher.from && handler.matcher.from !== stanza.attrs.from) {
            return undefined;
        }

        if (handler.matcher.to && handler.matcher.to !== stanza.attrs.to) {
            return undefined;
        }

        var child = stanza.getChild(handler.matcher.name, handler.matcher.xmlns);

        if (!child) {
            return undefined;
        }

        return {
            child:child,
            stanza:stanza
        };
    }

    function processDisco(element) {
        var children = element.children,
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

    function processStanza(handlers, events, stanza, probeBuddies) {
        events.emit('stanza', stanza);

        if (stanza.is('message')) {
            return processMessage(events, stanza);
        }

        if (stanza.is('presence')) {
            return processPresence(events, stanza, probeBuddies);
        }

        for (var idx in handlers) {
            var handler = handlers[idx];
            var matched = match(stanza, handler);

            if (matched) {
                if (matched.stanza.attrs.type == 'error') {
                    return handler.callback(matched.stanza);
                }

                return handler.callback(undefined, processDisco(matched.child), matched.stanza);
            }
        }

        debug("tangling stanza", stanza);
    }

    function sendMessage(pending, connection) {
        var args = Array.prototype.splice.call(arguments, 2);

        if (pending) {
            return pending.push(args);
        }

        return xmpp.Client.prototype.send.apply(connection, args);
    }

    function SimpleXMPP(params) {
        EventEmitter.call(this);

        var connection,
            config = {
                jid:new xmpp.JID(params.jid),
                password:params.password,
                host:params.host,
                port:params.port
            },
            probeBuddies = {},
            handlers = [],
            pending = [],
            self = this;

        process.nextTick(function () {
            connection = new xmpp.Client(config);
            connection.on('stanza', function (stanza) {
                processStanza(handlers, self, stanza, probeBuddies);
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
        self.discoverServices = function (to, cb) {
            var disco = new xmpp.Iq({
                    type:'get',
                    to:to
                });

            disco.c('query', { xmlns:DISCO_URL });

            if (handlers) {
                handlers.push({
                    matcher:{
                        from:to,
                        xmlns:DISCO_URL,
                        name:'query'
                    },
                    callback:cb
                });
            }

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
        self.send = function (to, message) {
            var stanza = new xmpp.Message({
                to:to,
                type:'chat'
            });
            stanza.c('body').t(message);

            sendMessage(pending, connection, stanza);
        };
        self.probe = function (buddy, callback) {
            probeBuddies[buddy] = true;

            var stanza = new xmpp.Presence({
                type:'probe',
                to:buddy
            });
            self.once('probe_' + buddy, callback);
            sendMessage(pending, connection, stanza);
        };
    }

    util.inherits(SimpleXMPP, EventEmitter);

    module.exports = function (config) {
        return new SimpleXMPP(config);
    };
})(module);