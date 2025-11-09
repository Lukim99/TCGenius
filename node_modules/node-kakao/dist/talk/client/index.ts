/*
 * Created on Mon Jan 18 2021
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */

import { CommandSession, ConnectionSession, SessionFactory } from '../../network';
import { ChannelUser, ChannelUserInfo } from '../../user';
import { AsyncCommandResult, DefaultReq, DefaultRes } from '../../request';
import { Managed } from '../managed';
import { OAuthCredential } from '../../oauth';
import { ClientConfig, DefaultConfiguration } from '../../config';
import { ChatSessionInfo, ClientSession, LoginResult } from '../../client';
import { TalkSessionFactory } from '../network';
import { TalkClientSession } from './talk-client-session';
import { KickoutRes } from '../../packet/chat';
import { EventContext, TypedEmitter } from '../../event';
import { ClientStatus } from '../../client-status';
import { TalkChannelList } from '../talk-channel-list';
import { ClientEvents } from '../event';
import { Long } from 'bson';
import { TalkBlockSession } from '../block';
import { TalkChannel } from '../channel';
import { ClientDataLoader } from '../../loader';
import { TalkInMemoryDataLoader } from '../loader';
import * as http2 from 'http2';

export * from './talk-client-session';

/**
 * Talk client session with client user
 */
export interface TalkSession extends CommandSession {

  readonly clientUser: Readonly<ChannelUser>;

  readonly configuration: Readonly<ClientConfig>;

}

type TalkClientEvents = ClientEvents<TalkChannel, ChannelUserInfo>;

/**
 * Simple client implementation.
 */
export class TalkClient
  extends TypedEmitter<TalkClientEvents> implements CommandSession, ClientSession, Managed<TalkClientEvents> {
  private _session: ConnectionSession | null;

  /**
   * Ping request interval. (Default = 60000 (1 min))
   */
  public pingInterval: number;
  private _pingTasks: {
    socket: number,
    ping: number,
    listen: number
  };

  private _chatSessionInfo: ChatSessionInfo;

  private _clientSession: TalkClientSession;

  private _clientUser: ChannelUser;
  private _blockList: TalkBlockSession;

  private _channelList: TalkChannelList;

  constructor(
    config: Partial<ClientConfig> = {},
    loader: ClientDataLoader = TalkInMemoryDataLoader,
    private _sessionFactory: SessionFactory = new TalkSessionFactory(),
  ) {
    super();

    this.pingInterval = 30_000; // tablet에서는 3~5분 사이에서 ping함. 하지만 그렇게 설정하면 연결 끊김 현상이 자주 발생함
    this._pingTasks = {
      socket: 0,
      ping: 0,
      listen: 0
    };
    this._chatSessionInfo = { lastBlockId: 0, lastTokenId: Long.ZERO };

    this._session = null;
    this._clientSession = new TalkClientSession(this.createSessionProxy(), { ...DefaultConfiguration, ...config });

    this._channelList = new TalkChannelList(this.createSessionProxy(), loader);
    this._clientUser = { userId: Long.ZERO };
    this._blockList = new TalkBlockSession(this.createSessionProxy());
  }

  get configuration(): ClientConfig {
    return this._clientSession.configuration;
  }

  set configuration(configuration: ClientConfig) {
    this._clientSession.configuration = configuration;
  }

  get channelList(): TalkChannelList {
    return this._channelList;
  }

  get clientUser(): ChannelUser {
    if(!this.logon) {
      throw new Error("Cannot access logging in");
    }

    return this._clientUser;
  }

  get blockList(): TalkBlockSession {
    return this._blockList;
  }

  /**
   * true if session created
   */
  get logon(): boolean {
    return this._session != null;
  }

  get chatSessionInfo(): ChatSessionInfo {
    return this._chatSessionInfo;
  }

  private get session() {
    if (this._session == null) throw new Error('Session is not created');

    return this._session;
  }

  async login(credential: OAuthCredential, sessionInfo: ChatSessionInfo = { lastBlockId: 0, lastTokenId: Long.ZERO }, lightLogin = false): AsyncCommandResult<LoginResult> {
    if (this.logon) this.close();

    // Create session stream
    const sessionRes = await this._sessionFactory.connect(credential.userId, this.configuration);
    if (!sessionRes.success) return sessionRes;
    this._session = sessionRes.result;

    const loginRes = await this._clientSession.login(credential, sessionInfo);
    if (!loginRes.success) return loginRes;

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
    
    this.request("GETTOKEN", { "ts": [ 2, 3, 11, 12, 4, 9, 10, 15 ] });
    this.setStatus(1);
    
    // http2 추가 수행
    // ping, listen, more_settings.json
    if(!lightLogin) {
      await TalkChannelList.initialize(this._channelList, loginRes.result.channelList); 
    }

    return { status: loginRes.status, success: true, result: loginRes.result };
  }

  setStatus(status: ClientStatus): AsyncCommandResult {
    return this._clientSession.setStatus(status);
  }

  getTokens(unknown: number[]): AsyncCommandResult<DefaultRes> {
    return this._clientSession.getTokens(unknown);
  }

  /**
   * @param {ChannelUser} user Target user to compare
   *
   * @return {boolean} true if client user.
   */
  isClientUser(user: ChannelUser): boolean {
    return this._clientUser.userId.equals(user.userId);
  }

  /**
   * End session
   */
  close(): void {
    if (!this.session.stream.ended) {
      this.session.stream.close();
    }
  }

  async pushReceived(method: string, data: DefaultRes, ctx: EventContext<TalkClientEvents>): Promise<void> {
    await this._channelList.pushReceived(method, data, ctx);

    switch (method) {
      case 'KICKOUT': {
        super.emit('disconnected', (data as DefaultRes & KickoutRes).reason);
        this.close();
        break;
      }

      case 'CHANGESVR': {
        super.emit('switch_server');
        break;
      }

      case 'BLSYNC': // LocoBlockSyncPush 넣으면 오류 발생
        this.request('BLSYNC', {r: 1, pr: 1})
        break;

      case 'MSG':
        this.request('MSG', {notiRead: false}) // false가 더 자연스러울듯. true 하면 syncmsg 해야함
        break;
    }

    super.emit('push_packet', method, data);
  }

  /**
   * Create proxy that can be used safely without exposing client
   *
   * @return {TalkSession}
   */
  createSessionProxy(): TalkSession {
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

  request<T = DefaultRes>(method: string, data: DefaultReq): Promise<DefaultRes & T> {
    return this.session.request<T>(method, data);
  }

  private listenEnd() {
    if (this._session) this._session = null;
    
    clearTimeout(this._pingTasks.socket);
    clearInterval(this._pingTasks.ping);
    clearInterval(this._pingTasks.listen);
  }

  private onError(err: unknown) {
    super.emit('error', err);

    if (this.listeners('error').length > 0 && !this.session.stream.ended) {
      this.listen();
    } else {
      this.close();
    }
  }

  private listen() {
    (async () => {
      for await (const { method, data, push } of this.session.listen()) {
        if (push) {
          try {
            await this.pushReceived(method, data, new EventContext<TalkClientEvents>(this));
          } catch (err) {
            this.onError(err);
          }
        }
      }
    })().then(() => this.listenEnd()).catch((err) => this.onError(err));
  }

  private addPingHandler() {
    const pingHandler = () => {
      if (!this.logon) return;

      this.session.request('PING', {}).catch((err) => this.onError(err));
      // Fix weird nodejs typing
      this._pingTasks.socket = setTimeout(pingHandler, this.pingInterval) as unknown as number;
    };
    pingHandler();
  }

  private addHttpPingHandler(headers: Record<string, string>) {
    const session = http2.connect(this.configuration.locoPilsnerHost);

    const httpPingHandler = () => {
      try {
        const req = session.request({ ":method": "GET", ":path": "/ping", ...headers });
    
        req.end();

        req.on("data", (chunk) => {});
        req.on("end", () => {
          console.log("ping end");
        });
      } catch (e) {
        console.log(e);
      }
    };
    httpPingHandler();
    this._pingTasks.ping = setTimeout(httpPingHandler, Math.floor(Math.random() * 120000) + 120000) as unknown as number;
  }

  private addHttpListenHandler(headers: Record<string, string>) {
    const session = http2.connect(this.configuration.locoPilsnerHost);

    const httpListenHandler = () => {
      try {
        const req = session.request({ ":method": "GET", ":path": "/listen", ...headers });
  
        req.end();

        req.on("data", (chunk) => {});

        setTimeout(() => {
          req.close();
          console.log("listen end");
        }, 120000);

      } catch (e) {
        console.log(e);
      };
    }
    httpListenHandler();
    this._pingTasks.listen = setTimeout(httpListenHandler, 121_000) as unknown as number;
  }
}
