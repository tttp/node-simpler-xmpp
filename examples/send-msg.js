var util = require("util");

if (process.argv.length < 5) {
    console.log("please pass jid, password, and the destination address as command line params");
    process.exit(1);
}

var simpler = require('../index'),
    jid = process.argv[2],
    password = process.argv[3],
    to = process.argv[4],
    xmpp = simpler({
        jid:jid,
        password:password,
        host:'talk.google.com'
    }),
    connection;

xmpp.on('online', function () {
    console.log('Yes, I\'m connected!');
    connection.send(to, "this is a message from the send-msg script");
});

xmpp.on('chat', function (from, message) {
    console.log("from %s: ", from, message);
});

xmpp.on('error', function (err) {
    console.error(err);
});

connection = xmpp.connect();
