/*
 * Created on Tue Jul 07 2020
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DefaultConfiguration = void 0;
    exports.DefaultConfiguration = {
        locoBookingHost: 'booking-loco.kakao.com',
        locoPilsnerHost: 'https://talk-pilsner.kakao.com',
        locoBookingPort: 443,
        // eslint-disable-next-line max-len
        locoPEMPublicKey: `-----BEGIN PUBLIC KEY-----\nMIIBIDANBgkqhkiG9w0BAQEFAAOCAQ0AMIIBCAKCAQEArFhojUWXqu7GRj8GWNIgX5J6w23jbW3spYzLvQqLSKct6EVD6Ut9dfXCA/wCE/9FfPeJBEhqsY5JxYUEHVvz+2m7+cjDCxbQThSG5z1hDSggLxA30QRBF2/gKDo6um9Ng0q4QDO+3+mqVw1cVox0Xt++R4UdNT2BkVG+vp0T2c5e1QdeKvYnHYImPbeocGY+SHRcMWeZPfUrk0bLbnw6O/KDei5LOVk435LEsKHNtj7u4fswCVds4IFtgjjBrtrvhk4CitOcRrVVyeuODIuXy7g3dca1ZLPLxhb6fT25UtKd+8/jFTIMh4n/ul2u6pi7ny+WlEPPeBshwy4iPQ63PQIBAw==\n-----END PUBLIC KEY-----`,
        agent: 'android',
        version: '10.2.0',
        osVersion: '7.1.2',
        // 0 == wired(WIFI), 3 == cellular
        netType: 0,
        // 45005: KT
        mccmnc: '45005',
        countryIso: 'KR',
        language: 'ko',
        deviceModel: 'SM-T870',
    };
});
//# sourceMappingURL=config.js.map