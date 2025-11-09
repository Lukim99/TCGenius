/*
 * Created on Thu Jan 28 2021
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */

import { randomUUID } from 'crypto';
import { RequestHeader } from '.';
import { WebApiConfig } from '../config';
import { OAuthCredential } from '../oauth';

export function fillAHeader(header: RequestHeader, config: WebApiConfig): void {
  header['A'] = `${config.agent}/${config.version}/${config.language}`;
}

export function fillBaseHeader(header: RequestHeader, config: WebApiConfig): void {
  header['Accept-Language'] = config.language;
}

export function getUserAgent(config: WebApiConfig): string {
  let os = '';
  if (config.agent === 'win32') {
    os = `Wd/${config.osVersion}`;
  } else if (config.agent === 'android') {
    os = `An/${config.osVersion}`;
  } else {
    os = `Wd/${config.osVersion}`;
  }

  return `KT/${config.version} ${os} ${config.language}`;
}

export function fillCredential(header: RequestHeader, credential: OAuthCredential): void {
  header['Authorization'] = `${credential.accessToken}-${credential.deviceUUID}`;
}

export function fillAdidHeader(header: RequestHeader, config: WebApiConfig): void {
  header['Adid'] = randomUUID();
}
