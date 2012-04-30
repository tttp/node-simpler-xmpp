var util = require("util");

if (process.argv.length < 5) {
    console.log("please pass jid, password, and the destination address as command line params");
    process.exit(1);
}

var simpler = require('../index'),
    Element = require('node-xmpp').Element,
    jid = process.argv[2],
    password = process.argv[3],
    to = process.argv[4],
    client = simpler({
        jid:jid,
        password:password,
        host:'talk.google.com'
    }),
    connection;

client.on('online', function () {
    console.log('Yes, I\'m connected!');
});

client.on('chat', function (from, message) {
    console.log("from %s: ", from, message);
});

client.on('error', function (err) {
    console.error(err);
});

client.send(to, "this is a message from the send-msg script at " + new Date());
client.discoverServices('gmail.com', function(err, result) {
    if (err) {
        return console.error("discovery failed", util.inspect(err, false, 10));
    }
    
    console.log("discovered", util.inspect(result, false, 10));
});