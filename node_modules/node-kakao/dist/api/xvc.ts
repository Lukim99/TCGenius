/*
 * Created on Wed Feb 17 2021
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */

import { sha512 } from 'hash-wasm';

export interface XVCProvider {

  toFullXVCKey(deviceUUID: string, userAgent: string, email: string): Promise<string>;

}

export const Win32XVCProvider: XVCProvider = {

  toFullXVCKey(deviceUUID: string, userAgent: string, email: string): Promise<string> {
    const source = `JAYDEN|${userAgent}|JAYMOND|${email}|${deviceUUID}`;
    return sha512(source);
  }

}

export const AndroidSubXVCProvider: XVCProvider = {

  toFullXVCKey(_: string, userAgent: string, email: string): Promise<string> {
    const source = `CAREY|${userAgent}|GLENN|${email}|PETER`; // kakaotalk 9.9.1 apk
    return sha512(source);
  }

}
