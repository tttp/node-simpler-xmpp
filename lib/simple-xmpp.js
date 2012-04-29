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

    var STATUS_ONLINE = "online",
        STATUS_OFFLINE = "offline",
        xmpp = require('node-xmpp'),
        debug = require('./debug'),
        EventEmitter = require('events').EventEmitter,
        util = require('util');

    function SimpleXMPP(connection, events, probeBuddies) {
        this.send = function (to, message) {
            var stanza = new xmpp.Element('message', {
                to:to,
                type:'chat'
            });
            stanza.c('body').t(message);
            connection.send(stanza);
        };

        this.probe = function (buddy, callback) {
            probeBuddies[buddy] = true;

            var stanza = new xmpp.Element('presence', {
                type:'probe',
                to:buddy
            });
            events.once('probe_' + buddy, callback);
            connection.send(stanza);
        };

        this.on = function (event, listener) {
            events.on(event, listener);
        };

        this.removeListener = function (event, listener) {
            return events.removeListener(event, listener);
        };

        this.removeAllListeners = function (event) {
            return events.removeListener(event);
        }
    }

    function getState(stanza) {
        if (stanza.attrs.type === 'unavailable') {
            return STATUS_OFFLINE;
        }

        var show = stanza.getChild('show');

        if (!show) {
            return STATUS_ONLINE;
        }

        var state = show.getText();

        if (state === 'chat') {
            return STATUS_ONLINE;
        }

        return state;
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

    function processStanza(events, stanza, probeBuddies) {
        events.emit('stanza', stanza);
        debug("stanza", stanza);

        if (stanza.is('message')) {
            return processMessage(events, stanza);
        }

        if (!stanza.is('presence')) {
            return;
        }

        //looking for presence stenza for availability changes
        var frm = stanza.attrs.from;

        if (!frm) {
            return;
        }
        var iD = frm.split('/')[0];
        var state = getState(stanza);

        if (probeBuddies[iD]) {
            events.emit('probe_' + iD, state);
            delete probeBuddies[iD];
        } else {
            events.emit('buddy', iD, state);
        }

    }

    function connect(config, events, probeBuddies) {
        var conn = new xmpp.Client(config);

        conn.on('online', function () {
            conn.send(new xmpp.Element('presence'));
            events.emit('online');
            //make the connection live
            setInterval(function () {
                conn.send(new xmpp.Element('presence'));
            }, 1000 * 10)
        });

        conn.on('stanza', function (stanza) {
            debug("stanza", util.inspect(stanza, true, 100));
            processStanza(events, stanza, probeBuddies);
        });

        conn.on('error', function (err) {
            debug("error", util.inspect(err, true, 100));
            events.emit('error', err);
        });

        return new SimpleXMPP(conn, events, probeBuddies);
    }

    module.exports = function (config) {
        var events = new EventEmitter();
        var probeBuddies = {};

        return {
            "on":function (event, listener) {
                return events.on(event, listener);
            },

            "removeListener":function (event, listener) {
                return events.removeListener(event, listener);
            },

            "removeAllListeners":function (event) {
                return events.removeListener(event);
            },

            "setMaxListeners":function (n) {
                return events.setMaxListeners(n);
            },

            "connect":function () {
                return connect(config, events, probeBuddies);
            }
        };
    };
})(module);