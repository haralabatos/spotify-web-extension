console.log('play.spotify.com content script injected');


chrome.runtime.onMessage.addListener(messageRecv);
function messageRecv(msg) {
    console.log('content script received message from chrome.runtime',msg);
}


var port = chrome.runtime.connect({name: "play.spotify.com.content_script"});

port.postMessage({message: "content_script_loaded"});
port.onMessage.addListener(function(msg) {
    console.log('content script received message on port',msg);
});


var s = document.createElement("script");
s.src = chrome.extension.getURL("js/play.spotify.com.inject.js");
s.onload = function() {
  this.parentNode.removeChild(this);
};
document.body.appendChild(s);