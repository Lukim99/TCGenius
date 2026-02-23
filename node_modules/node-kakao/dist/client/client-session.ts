/*
 * Created on Wed Jan 20 2021
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */

import { Long } from 'bson';
import { LoginData, NormalChannelData } from '../channel';
import { ClientStatus } from '../client-status';
import { OAuthCredential } from '../oauth';
import { OpenChannelData } from '../openlink';
import { AsyncCommandResult } from '../request';

export interface ChatSessionInfo {
  lastBlockId: number;
  lastTokenId: Long;
}

export interface LoginResult {

  channelList: (LoginData<NormalChannelData | OpenChannelData>)[];

  /**
   * Client user id
   */
  userId: Long;

  /**
   * Last channel id
   */
  lastChannelId: Long;

  lastTokenId: Long;
  mcmRevision: number;

  /**
   * Removed channel id list
   */
  removedChannelIdList: Long[];

  revision: number;
  revisionInfo: string;

  /**
   * Minimum log id
   */
  minLogId: Long;

  chatSessionInfo: ChatSessionInfo;
}

export interface ClientSession {

  /**
   * Login using credential.
   * Perform LOGINLIST
   *
   * @param credential
   */
  login(credential: OAuthCredential, sessionInfo: ChatSessionInfo): AsyncCommandResult<LoginResult>;

  /**
   * Set client status
   */
  setStatus(status: ClientStatus): AsyncCommandResult;

}
