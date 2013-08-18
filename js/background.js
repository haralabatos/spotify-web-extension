var BGPID = Math.floor(Math.random() * Math.pow(2,31))
console.assert( chrome.app.getDetails().id == config.extension_id )
console.log("%cBackground page load!","background: #2B2; color: #00000", BGPID)

var logconfig = {
    injected: true,
    other: false
}

chrome.runtime.onInstalled.addListener( function(install_data) {
    console.log('chrome runtime onInstalled',install_data, 'running version:', chrome.app.getDetails().version)
    
    if (install_data.reason == "install" ||
        install_data.reason == "update" ) {     //"install", "update", or "chrome_update"
    }
});

window.spwebconn_id = 0;

function SpotifyWebConnection(port, manager) {
    this._id = window.spwebconn_id++;
    this.port = port;
    this.manager = manager;
    port.onMessage.addListener( this.handle_message.bind(this) )
    port.onDisconnect.addListener( manager.handle_disconnect.bind(manager) )
    //this.send_to_content( { BGPID:BGPID, message: "background page received your connection. Thanks :-)", data: new Uint8Array([1,2,3,4]) } )
}

SpotifyWebConnection.prototype = {
    handle_message: function(msg) {
        if (msg.message && msg.message.msgevt) {
            var data = msg.message.msgevt.data
            if (typeof data == "string") {
                // comes from content script postMessage, try to JSON parse and shit
                try {
                    data = JSON.parse(data)
                } catch(e) { }
                //console.log('handle message','SpotifyWebConnection'+this._id, msg.message.msgevt.type, data);
            } else {

                if (data.sender == "extension" && 
                    data.injected_script == config.pagename + '.inject.js' &&
                    data.extension_id == config.extension_id) {
                    
                    console.log('received message from main page javascript context',data);

                    if (data.message && data.message.payload && data.message.requestid) {
                        api.handle_webpage_api_response( data.message )
                    }

                }

            }
        } else {
            //console.log('handle message','SpotifyWebConnection'+this._id, msg);
        }
    },
    send_to_content: function(msg) {
        this.port.postMessage( msg )
    },
    send_api_message_to_webpage: function(requestid, msg) {
        // special type of message
        this.port.postMessage( { requestid: requestid, cc: config.pagename, payload: msg } )
    }
}

function PortConnections() {
    this._tab_connections = {}
    this._connected = 0;
    this._play_tabs = {};
    this._active_play_tab = null;
}

PortConnections.prototype = {
    handle_connection: function(port) {
        if (port.sender && port.sender.id == chrome.app.getDetails().id) {

            var tabId = port.sender.tab.id;

            console.assert( tabId );

            console.assert(port.name);
            console.log('content script connection from', port.name+'.js, url:', port.sender.url,'on tab',port.sender.tab.id);

            var spwebconn = new SpotifyWebConnection(port, this);

            console.assert( ! this._tab_connections[tabId] )

            this._tab_connections[tabId] = spwebconn
            this._connected++;
            console.assert( Object.keys(this._tab_connections).length == this._connected );

            if (port.name == config.pagename + '.content_script') {
                this._play_tabs[ tabId ] = spwebconn

                if (! this._active_play_tab) {
                    this._active_play_tab = spwebconn
                }
            }
            console.log('Total content script connections now', this._connected);
        } else {
            console.log('unrecognized chrome extension message',port);
            port.disconnect()
        }
    },
    handle_disconnect: function(port) {
        var tabId = port.sender.tab.id
        console.log('content script port disconnected', tabId, port);
        console.assert( tabId )

        if (port.name == config.pagename + '.content_script') {
            console.assert( this._tab_connections[tabId] )
            delete this._play_tabs[tabId]
            if (Object.keys( this._play_tabs ).length == 0) {
                this._active_play_tab = null;
            }
        }
        console.assert(this._tab_connections[tabId])
        delete this._tab_connections[tabId]
        this._connected--;
    },
    get: function(type) {
        if (type == 'content_script') {
            return this._active_play_tab;
        } else if (type == 'popup') {
            return this._connections['popup']
        } else {
            console.assert(false);
        }
    }
}


var ports = new PortConnections;
chrome.runtime.onConnect.addListener( ports.handle_connection.bind(ports) )

chrome.permissions.getAll( function(a) {
    console.log("permissions",a);
});


// on background page load, do this stuff...
// INJECT into our content script
chrome.tabs.query( { url: "*://"+config.pagename+"/*" }, function(tabs) {
    console.log('Found',config.pagename,tabs.length,'tabs',tabs)
    tabs.forEach( function(tab) {
        inject_content_scripts(tab)
    });
});

chrome.tabs.onReplaced.addListener( function(added, removed) {
    console.log('chrome.tabs.onReplaced', added, removed);
});
chrome.tabs.onCreated.addListener( function(tab) {
    console.log('chrome.tabs.onCreated', tab);
});

function inject_content_scripts(tab, updateInfo) {
    /* called each time a chrome.tabs.tabUpdate is triggered (basically every single type of navigation, even sub-iframes */

    chrome.tabs.executeScript( tab.id, { code: "var updateInfo="+JSON.stringify(updateInfo)+";var BGPID = " + BGPID + ";[window.location.origin,window.location.hostname];" }, function(results0) {

        if (results0 === undefined) {
            console.log('unable to execute content script')
            // no permission to execute content scripts
            return
        } else {
            var tabinfo = results0[0];
            console.log('content script returns info:',tabinfo);

            var origin = tabinfo[0]
            var hostname = tabinfo[1]

            chrome.tabs.executeScript( tab.id,  { file: 'js/common.js' }, function(results1) {
                if (hostname == config.pagename) {
                    chrome.tabs.executeScript( tab.id, { file: 'js/'+config.pagename+'.content_script.js' }, function(resultsa) {
                        console.log(config.pagename,'content_script injected', resultsa);
                    })
                } else {
                    chrome.tabs.executeScript( tab.id, { file: 'js/all.content_script.js' }, function(resultsb) {
                        console.log('all.content_script injected', resultsb)
                    })
                }
            })
        }
    })
}

chrome.tabs.onUpdated.addListener( function(tabId, changeInfo, tab) {
    var updateInfo = {event:'onUpdated',changeInfo:changeInfo,tabInfo:tab.status}
    // console.log('tab change',tabId,changeInfo.status,changeInfo.url);
    inject_content_scripts(tab, updateInfo)
})


function SpotifyWebAPI() {
    this._requests = {}
    this._requestctr = 1;
    this._timeout_interval = 40000;
    this._playerframenum = 0;
}
SpotifyWebAPI.prototype = {
    get_conn: function() {
        return ports.get('content_script')
    },
    handle_request_timeout: function(requestid) {
        console.log('API request timeout',requestid)
        var callbackinfo = this._requests[requestid]
        delete this._requests[requestid]
        if (callbackinfo.callback) { callbackinfo.callback({timeout:true}) }
    },
    send_to_webpage: function(msg, cb) {
        var requestid = this._requestctr++
        var request_timeout = setTimeout( this.handle_request_timeout.bind(this, requestid), this._timeout_interval );
        this._requests[requestid] = {callback:cb, timeout:request_timeout}
        var conn = this.get_conn()
        console.assert( conn )
        conn.send_api_message_to_webpage( requestid, msg )
    },
    handle_webpage_api_response: function(msg) {
        console.log('SpotifyWebAPI handle response!',msg)
        var callbackinfo = this._requests[msg.requestid]
        console.assert( callbackinfo ) // response came back after timeout_interval
        clearTimeout( callbackinfo.timeout )
        delete this._requests[msg.requestid]
        var cb = callbackinfo.callback;
        if (cb) {
            cb(msg.payload);
        }
    },
    get_frames: function(cb) {
        this.send_to_webpage( { command: 'getframes' }, cb )
    },
    get_playing: function(framenum, cb) {
        console.assert(typeof framenum == 'number')
        this.send_to_webpage( { framenum: framenum, command: 'getplayerstuff' }, cb )
    },
    get_rootlist: function(cb) {
        this.send_to_webpage( { framenum: this._playerframenum, command: 'get_rootlist' }, cb )
    }
}

// nextSong(), playpause(), getSongPlayed(), getArt(), getQueue(), etc
var api = new SpotifyWebAPI;


/*

TODO: handle injecting content scripts once we gain all tabs.

use chrome.tabs permission somehow?
can use: chrome.tabs.onUpdated to see URL navigation changes :-)

http://stackoverflow.com/questions/16399093/moving-from-permissions-to-optional-permissions-how-to-handle-content-scripts/18293326#18293326
*/