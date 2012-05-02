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

    function emitError(hidden, stanza) {
        var error = {
            from: stanza.from,
            to: stanza.to,
            id: stanza.id
        };
        stanza.children.forEach(function(child) {
            if (child.name === 'body'){
                return error.body = child.children;
            }
            if (child.name === 'error'){
                error.error = {};

                child.children.forEach(function(grandchild){
                    if (grandchild.name === 'service-unavailable') {
                        error.error[grandchild.name] = grandchild.attrs.xmlns;
                    }
                });
            }
        });
        hidden.client.emit('error', error, stanza);
    }

    function processMessage(hidden, stanza) {
        if (stanza.attrs.type === 'error') {
            return emitError(hidden, stanza);
        }

        if (stanza.attrs.type !== 'chat') {
            return debug("not a chat message", util.inspect(stanza, true, 100));
        }

        var body = stanza.getChild('body');

        if (!body) {
            return debug("no body for chat message", util.inspect(stanza, true, 100));
        }

        var message = body.getText();

        hidden.client.emit('chat', stanza.attrs.from, message);
    }

    function processRoster(hidden, element) {
        hidden.roster = {};

        element.children.forEach(function (child) {
            hidden.roster[child.attrs.jid] = {
                subscription: child.attrs.subscription,
                name: child.attrs.name
            };
        });

        hidden.client.emit('roster', hidden.roster);
    }

    function setRoster(hidden, element) {
        element.children.forEach(function (child) {
            hidden.roster[child.attrs.jid] = {
                subscription: child.attrs.subscription,
                name: child.attrs.name
            };
        });

        hidden.client.emit('roster', hidden.roster);
    }

    function processIqResult(stanza, hidden) {
        stanza.children.forEach(function (child) {
            if (child.attrs.xmlns === ROSTER_URN) {
                return processRoster(hidden, child);
            }
            return debug("unknown query response", util.inspect(stanza, true, 100));
        });
    }

    function setIq(stanza, hidden) {
        stanza.children.forEach(function (child) {
            if (child.attrs.xmlns === ROSTER_URN) {
                return setRoster(hidden, child);
            }
            return debug("unknown query response", util.inspect(stanza, true, 100));
        });

        sendMessage(hidden, new xmpp.Iq({ id: stanza.attrs.id, type: 'result' }));
    }

    function processIQ(hidden, stanza) {
        if (stanza.attrs.type === 'error') {
            return emitError(hidden, stanza);
        }

        if (stanza.attrs.type === 'set') {
            return setIq(stanza, hidden);
        }

        if (stanza.attrs.type === 'result') {
            return processIqResult(stanza, hidden);
        }

        return debug("unknown iq type", util.inspect(stanza, true, 100));
    }

    function processPresence(hidden, stanza) {
        if (stanza.attrs.type === 'error') {
            return emitError(hidden, stanza);
        }

        if (!stanza.attrs.from) {
            return debug("presence without from address", util.inspect(stanza, true, 100));
        }

        if (!stanza.children) {
            return debug("presence without content", util.inspect(stanza, true, 100));
        }

        var presence = hidden.presence[stanza.attrs.from] = {};

        stanza.children.forEach(function(child){
            var xmlns = child.attrs.xmlns,
                name = child.name;

            if (child.name === 'show') {
                presence.show = child.attrs.children;
            }
            else if (child.name === 'status') {
                presence.status = child.attrs.children;
            }
            else if (child.name === 'priority') {
                presence.status = child.attrs.children;
            }
            else if (child.attrs.xmlns === 'http://jabber.org/protocol/caps') {
                presence.caps = {
                    hash: child.attrs.hash,
                    node: child.attrs.node,
                    ver: child.attrs.ver
                };
            }
            else if (child.attrs.xmlns === 'vcard-temp:x:update') {
                presence.vcard = {};

                child.children.forEach(function(entry){
                    presence.vcard[entry.name] = entry.children;
                });
            }
            else {
                return debug("unhandled presence indicator", util.inspect(child, true, 100));
            }
        });

        hidden.client.emit("presence", stanza.attrs.from, presence, hidden.presence);
    }

    function processStanza(hidden, stanza) {
        hidden.client.emit('stanza', stanza);

        if (stanza.is('message')) {
            return processMessage(hidden, stanza);
        }

        if (stanza.is('presence')) {
            return processPresence(hidden, stanza);
        }

        if (stanza.is('iq')) {
            return processIQ(hidden, stanza);
        }

        // TODO
        debug("unhandled stanza", util.inspect(stanza, true, 100));
    }

    function sendMessage(hidden, stanza) {
        stanza.id = makeId();

        if (hidden.pending) {
            hidden.pending.push(stanza);
        }
        else {
            hidden.connection.send(stanza);
        }

        return stanza.id;
    }

    function queryRoster(hidden) {
        var stanza = new xmpp.Iq({ type:'get' });

        stanza.c('query', { xmlns:ROSTER_URN});

        return sendMessage(hidden, stanza);
    }

    function init(hidden) {
        hidden.connection = new xmpp.Client(hidden.config);
        hidden.connection.on('stanza', function (stanza) {
            processStanza(hidden, stanza);
        });
        hidden.connection.on('error', function (err) {
            return emitError(hidden, err);
        });
        hidden.connection.on('online', function () {
            hidden.client.emit('online');

            setInterval(function () {
                sendMessage(hidden, new xmpp.Presence());
            }, hidden.config.presenceInterval || 15000);

            var queue = hidden.pending;

            delete hidden.pending;

            queue.forEach(function (stanza) {
                hidden.connection.send(stanza);
            });

            queryRoster(hidden);
        });
    }

    function SimpleXMPP(params) {
        EventEmitter.call(this);

        var self = this,
            hidden = {
                // connection
                // roster
                client:self,
                pending:[],
                presence:{},
                config:{
                    jid:new xmpp.JID(params.jid),
                    password:params.password,
                    host:params.host,
                    port:params.port
                }
            };

        process.nextTick(function () {
            init(hidden);
        });

        this.send = function (to, message) {
            var stanza = new xmpp.Message({
                to:to,
                type:'chat'
            });
            stanza.c('body').t(message);

            return sendMessage(hidden, stanza);
        };
        this.addBuddy = function (jid, cb) {
            var stanza = new xmpp.Presence({
                to:jid,
                type:'subscribe'
            });

            sendMessage(hidden, stanza);
        };
    }

    util.inherits(SimpleXMPP, EventEmitter);

    module.exports = function (config) {
        return new SimpleXMPP(config);
    };
})(module);