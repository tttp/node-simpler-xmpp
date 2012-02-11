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
var xmpp = require('node-xmpp');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var STATUS = {
    ONLINE: "online",
    OFFLINE: "offline"
};

function SimpleXMPP(conn, events, probeBuddies) {
    this.send = function (to, message) {
        var stanza = new xmpp.Element('message', {
            to: to,
            type: 'chat'
        });
        stanza.c('body').t(message);
        conn.send(stanza);
    };

    this.probe = function (buddy, callback) {
        probeBuddies[buddy] = true;

        var stanza = new xmpp.Element('presence', {
            type: 'probe',
            to: buddy
        });
        events.once('probe_' + buddy, callback);
        conn.send(stanza);
    };
}

module.exports = function(config) {
    var events = new EventEmitter();
    var probeBuddies = {};

    return {
        "on": function (event, listener) {
            return events.on(event, listener);
        },

        "once": function (event, listener) {
            return events.once(event, listener);
        },

        "removeListener": function (event, listener) {
            return events.removeListener(event, listener);
        },

        "removeAllListeners": function (event) {
            return events.removeListener(event);
        },

        "setMaxListeners": function (n) {
            return events.setMaxListeners(n);
        },

        "connect": function () {
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
                events.emit('stanza', stanza);
                //console.log(stanza);
                //looking for message stanza
                if (stanza.is('message')) {

                    //getting the chat message
                    if (stanza.attrs.type === 'chat') {

                        var body = stanza.getChild('body');
                        if (body) {
                            var message = body.getText();
                            var from = stanza.attrs.from;
                            var id = from.split('/')[0];
                            events.emit('chat', id, message);
                        }
                    }
                } else if (stanza.is('presence')) {
                    //looking for presence stenza for availability changes
                    var frm = stanza.attrs.from;

                    if (frm) {
                        var iD = frm.split('/')[0];
                        var state = (stanza.getChild('show')) ? stanza.getChild('show').getText() : STATUS.ONLINE;
                        state = (state === 'chat') ? STATUS.ONLINE : state;
                        state = (stanza.attrs.type === 'unavailable') ? STATUS.OFFLINE : state;
                        //checking if this is based on probe
                        if (probeBuddies[iD]) {
                            events.emit('probe_' + iD, state);
                            delete probeBuddies[iD];
                        } else {
                            //specifying roster changes
                            events.emit('buddy', iD, state);
                        }
                    }
                }
            });

            conn.on('error', function (err) {
                events.emit('error', err);
            });
            
            return new SimpleXMPP(conn, events, probeBuddies);
        }
    };
};