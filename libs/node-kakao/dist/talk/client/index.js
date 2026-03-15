/*
 * Created on Mon Jan 18 2021
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "../../config", "../network", "./talk-client-session", "../../event", "../talk-channel-list", "bson", "../block", "../loader", "http2", "./talk-client-session"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TalkClient = void 0;
    const config_1 = require("../../config");
    const network_1 = require("../network");
    const talk_client_session_1 = require("./talk-client-session");
    const event_1 = require("../../event");
    const talk_channel_list_1 = require("../talk-channel-list");
    const bson_1 = require("bson");
    const block_1 = require("../block");
    const loader_1 = require("../loader");
    const http2 = __importStar(require("http2"));
    __exportStar(require("./talk-client-session"), exports);
    /**
     * Simple client implementation.
     */
    class TalkClient extends event_1.TypedEmitter {
        constructor(config = {}, loader = loader_1.TalkInMemoryDataLoader, _sessionFactory = new network_1.TalkSessionFactory()) {
            super();
            this._sessionFactory = _sessionFactory;
            this.pingInterval = 30000; // tablet에서는 3~5분 사이에서 ping함. 하지만 그렇게 설정하면 연결 끊김 현상이 자주 발생함
            this._pingTasks = {
                socket: 0,
                ping: 0,
                listen: 0
            };
            this._chatSessionInfo = { lastBlockId: 0, lastTokenId: bson_1.Long.ZERO };
            this._session = null;
            this._clientSession = new talk_client_session_1.TalkClientSession(this.createSessionProxy(), { ...config_1.DefaultConfiguration, ...config });
            this._channelList = new talk_channel_list_1.TalkChannelList(this.createSessionProxy(), loader);
            this._clientUser = { userId: bson_1.Long.ZERO };
            this._blockList = new block_1.TalkBlockSession(this.createSessionProxy());
        }
        get configuration() {
            return this._clientSession.configuration;
        }
        set configuration(configuration) {
            this._clientSession.configuration = configuration;
        }
        get channelList() {
            return this._channelList;
        }
        get clientUser() {
            if (!this.logon) {
                throw new Error("Cannot access logging in");
            }
            return this._clientUser;
        }
        get blockList() {
            return this._blockList;
        }
        /**
         * true if session created
         */
        get logon() {
            return this._session != null;
        }
        get chatSessionInfo() {
            return this._chatSessionInfo;
        }
        get session() {
            if (this._session == null)
                throw new Error('Session is not created');
            return this._session;
        }
        async login(credential, sessionInfo = { lastBlockId: 0, lastTokenId: bson_1.Long.ZERO }, lightLogin = false) {
            if (this.logon)
                this.close();
            // Create session stream
            const sessionRes = await this._sessionFactory.connect(credential.userId, this.configuration);
            if (!sessionRes.success)
                return sessionRes;
            this._session = sessionRes.result;
            const loginRes = await this._clientSession.login(credential, sessionInfo);
            if (!loginRes.success)
                return loginRes;
            this._clientUser = { userId: loginRes.result.userId };
            this._chatSessionInfo = loginRes.result.chatSessionInfo;
            const pilsnerHeaders = {
                "Host": "talk-pilsner.kakao.com",
                "Authorization": `${credential.accessToken}-${credential.deviceUUID}`,
                "Talk-Agent": `android/${this.configuration.version}`,
                "Talk-Language": this.configuration.language,
                "Accept-Encoding": "gzip, deflate",
                "User-Agent": "okhttp/4.9.3"
            };
            this.addPingHandler();
            //this.addHttpPingHandler(pilsnerHeaders);
            //this.addHttpListenHandler(pilsnerHeaders);
            this.listen();
            this.request("GETTOKEN", { "ts": [2, 3, 11, 12, 4, 9, 10, 15] });
            this.setStatus(1);
            // http2 추가 수행
            // ping, listen, more_settings.json
            if (!lightLogin) {
                await talk_channel_list_1.TalkChannelList.initialize(this._channelList, loginRes.result.channelList);
            }
            return { status: loginRes.status, success: true, result: loginRes.result };
        }
        setStatus(status) {
            return this._clientSession.setStatus(status);
        }
        getTokens(unknown) {
            return this._clientSession.getTokens(unknown);
        }
        /**
         * @param {ChannelUser} user Target user to compare
         *
         * @return {boolean} true if client user.
         */
        isClientUser(user) {
            return this._clientUser.userId.equals(user.userId);
        }
        /**
         * End session
         */
        close() {
            if (!this.session.stream.ended) {
                this.session.stream.close();
            }
        }
        async pushReceived(method, data, ctx) {
            await this._channelList.pushReceived(method, data, ctx);
            switch (method) {
                case 'KICKOUT': {
                    super.emit('disconnected', data.reason);
                    this.close();
                    break;
                }
                case 'CHANGESVR': {
                    super.emit('switch_server');
                    break;
                }
                case 'BLSYNC': // LocoBlockSyncPush 넣으면 오류 발생
                    this.request('BLSYNC', { r: 1, pr: 1 });
                    break;
                case 'MSG':
                    this.request('MSG', { notiRead: false }); // false가 더 자연스러울듯. true 하면 syncmsg 해야함
                    break;
            }
            super.emit('push_packet', method, data);
        }
        /**
         * Create proxy that can be used safely without exposing client
         *
         * @return {TalkSession}
         */
        createSessionProxy() {
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const instance = this;
            return {
                request: (method, data) => this.request(method, data),
                get clientUser() {
                    return instance.clientUser;
                },
                get configuration() {
                    return instance.configuration;
                },
            };
        }
        request(method, data) {
            return this.session.request(method, data);
        }
        listenEnd() {
            if (this._session)
                this._session = null;
            clearTimeout(this._pingTasks.socket);
            clearInterval(this._pingTasks.ping);
            clearInterval(this._pingTasks.listen);
        }
        onError(err) {
            super.emit('error', err);
            if (this.listeners('error').length > 0 && !this.session.stream.ended) {
                this.listen();
            }
            else {
                this.close();
            }
        }
        listen() {
            (async () => {
                for await (const { method, data, push } of this.session.listen()) {
                    if (push) {
                        try {
                            await this.pushReceived(method, data, new event_1.EventContext(this));
                        }
                        catch (err) {
                            this.onError(err);
                        }
                    }
                }
            })().then(() => this.listenEnd()).catch((err) => this.onError(err));
        }
        addPingHandler() {
            const pingHandler = () => {
                if (!this.logon)
                    return;
                this.session.request('PING', {}).catch((err) => this.onError(err));
                // Fix weird nodejs typing
                this._pingTasks.socket = setTimeout(pingHandler, this.pingInterval);
            };
            pingHandler();
        }
        addHttpPingHandler(headers) {
            const session = http2.connect(this.configuration.locoPilsnerHost);
            const httpPingHandler = () => {
                try {
                    const req = session.request({ ":method": "GET", ":path": "/ping", ...headers });
                    req.end();
                    req.on("data", (chunk) => { });
                    req.on("end", () => {
                        console.log("ping end");
                    });
                }
                catch (e) {
                    console.log(e);
                }
            };
            httpPingHandler();
            this._pingTasks.ping = setTimeout(httpPingHandler, Math.floor(Math.random() * 120000) + 120000);
        }
        addHttpListenHandler(headers) {
            const session = http2.connect(this.configuration.locoPilsnerHost);
            const httpListenHandler = () => {
                try {
                    const req = session.request({ ":method": "GET", ":path": "/listen", ...headers });
                    req.end();
                    req.on("data", (chunk) => { });
                    setTimeout(() => {
                        req.close();
                        console.log("listen end");
                    }, 120000);
                }
                catch (e) {
                    console.log(e);
                }
                ;
            };
            httpListenHandler();
            this._pingTasks.listen = setTimeout(httpListenHandler, 121000);
        }
    }
    exports.TalkClient = TalkClient;
});
//# sourceMappingURL=index.js.map