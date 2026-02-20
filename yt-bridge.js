(function () {
    function getPlayerResponse() {
        var resp = null;
        var source = '';

        if (document.getElementById('movie_player') && typeof document.getElementById('movie_player').getPlayerResponse === 'function') {
            try {
                resp = document.getElementById('movie_player').getPlayerResponse();
                source = 'movie_player.getPlayerResponse()';
            } catch (e) {
                // ignore
            }
        }

        if (!resp && window.ytInitialPlayerResponse) {
            resp = window.ytInitialPlayerResponse;
            source = 'ytInitialPlayerResponse';
        }

        if (!resp && window.__INITIAL_PLAYER_RESPONSE__) {
            resp = window.__INITIAL_PLAYER_RESPONSE__;
            source = '__INITIAL_PLAYER_RESPONSE__';
        }

        if (!resp && window.ytcfg && typeof window.ytcfg.get === 'function') {
            var cfgResp = window.ytcfg.get('PLAYER_RESPONSE');
            if (cfgResp) {
                resp = cfgResp;
                source = 'ytcfg.get(PLAYER_RESPONSE)';
            }
        }

        if (!resp && window.ytcfg && window.ytcfg.data_ && window.ytcfg.data_.PLAYER_RESPONSE) {
            resp = window.ytcfg.data_.PLAYER_RESPONSE;
            source = 'ytcfg.data_.PLAYER_RESPONSE';
        }

        if (!resp && window.ytplayer && window.ytplayer.config && window.ytplayer.config.args) {
            var pr = window.ytplayer.config.args.player_response;
            if (typeof pr === 'string') {
                try {
                    resp = JSON.parse(pr);
                    source = 'ytplayer.config.args.player_response (json)';
                } catch (e) {
                    // ignore parse errors
                }
            } else if (pr) {
                resp = pr;
                source = 'ytplayer.config.args.player_response';
            }
        }

        return { response: resp, source: source };
    }

    try {
        window.postMessage({ type: 'MDCP_BRIDGE_READY' }, '*');
        var initial = getPlayerResponse();
        window.postMessage({ type: 'MDCP_PLAYER_RESPONSE', response: initial.response, source: initial.source }, '*');
    } catch (e) {
        window.postMessage({ type: 'MDCP_PLAYER_RESPONSE', response: null, error: String(e) }, '*');
    }

    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        var data = event.data;
        if (data && data.type === 'MDCP_GET_PLAYER_RESPONSE') {
            var requestId = data.requestId;
            if (!requestId) return;
            try {
                var result = getPlayerResponse();
                window.postMessage({
                    type: 'MDCP_GET_PLAYER_RESPONSE_RESULT',
                    requestId: requestId,
                    response: result.response,
                    source: result.source
                }, '*');
            } catch (e) {
                window.postMessage({
                    type: 'MDCP_GET_PLAYER_RESPONSE_RESULT',
                    requestId: requestId,
                    response: null,
                    source: '',
                    error: String(e)
                }, '*');
            }
            return;
        }
    });
})();
