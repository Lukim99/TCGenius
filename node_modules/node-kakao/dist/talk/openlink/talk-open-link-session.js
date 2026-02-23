/*
 * Created on Sun Jan 24 2021
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "../../openlink", "../../request", "../../packet/struct", "bson", "crypto"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TalkOpenLinkSession = void 0;
    const openlink_1 = require("../../openlink");
    const request_1 = require("../../request");
    const struct_1 = require("../../packet/struct");
    const bson_1 = require("bson");
    const crypto_1 = require("crypto");
    /**
     * Provides openlink operations
     */
    class TalkOpenLinkSession {
        constructor(_session) {
            this._session = _session;
            this._lastLinkToken = 0;
        }
        async getLatestLinkList() {
            const res = await this._session.request('SYNCLINK', {
                'ltk': this._lastLinkToken,
            });
            if (res.status !== request_1.KnownDataStatusCode.SUCCESS)
                return { status: res.status, success: false };
            const list = !res.ols ? [] : res.ols.map((struct) => {
                return { openLink: (0, struct_1.structToOpenLink)(struct), info: (0, struct_1.structToOpenLinkInfo)(struct) };
            });
            this._lastLinkToken = res.ltk;
            return { status: res.status, success: true, result: list };
        }
        async getOpenLink(...components) {
            const res = await this._session.request('INFOLINK', {
                'lis': components.map((component) => component.linkId),
            });
            if (res.status !== request_1.KnownDataStatusCode.SUCCESS)
                return { status: res.status, success: false };
            const list = res.ols ? res.ols.map(struct_1.structToOpenLink) : [];
            return { status: res.status, success: true, result: list };
        }
        async getJoinInfo(linkURL, referer = 'EW') {
            const res = await this._session.request('JOININFO', {
                'lu': linkURL,
                'ref': referer,
            });
            if (res.status !== request_1.KnownDataStatusCode.SUCCESS)
                return { status: res.status, success: false };
            return {
                status: res.status,
                success: true,
                result: { openLink: (0, struct_1.structToOpenLink)(res.ol), info: (0, struct_1.structToOpenLinkInfo)(res.ol) },
            };
        }
        async getKickList(link) {
            const res = await this._session.request('KLSYNC', {
                'li': link.linkId,
            });
            if (res.status !== request_1.KnownDataStatusCode.SUCCESS)
                return { status: res.status, success: false };
            return { status: res.status, success: true, result: res.kickMembers.map(struct_1.structToOpenLinkKickedUserInfo) };
        }
        async removeKicked(link, user) {
            const res = await this._session.request('KLDELITEM', {
                'li': link.linkId,
                'c': user.kickedChannelId,
                'kid': user.userId,
            });
            return { status: res.status, success: res.status === request_1.KnownDataStatusCode.SUCCESS };
        }
        async deleteLink(link) {
            const res = await this._session.request('DELETELINK', {
                'li': link.linkId,
                'adid': (0, crypto_1.randomUUID)()
            });
            return { status: res.status, success: res.status === request_1.KnownDataStatusCode.SUCCESS };
        }
        async react(link, flag) {
            const res = await this._session.request('REACT', {
                'li': link.linkId,
                'rt': flag ? 1 : 0,
            });
            return { status: res.status, success: res.status === request_1.KnownDataStatusCode.SUCCESS };
        }
        async getReaction(link) {
            const res = await this._session.request('REACTCNT', {
                'li': link.linkId,
            });
            if (res.status !== request_1.KnownDataStatusCode.SUCCESS)
                return { status: res.status, success: false };
            return {
                status: res.status,
                success: true,
                result: [res['rc'], res['rt']],
            };
        }
        async createOpenChannel(template, profile) {
            const reqData = {
                'lt': openlink_1.OpenLinkType.CHANNEL,
                'lip': template.linkCoverURL || '',
                'ptp': 1,
                'aptp': !template.mainProfileOnly,
                'ln': template.linkName,
                'pa': template.activated,
                'ri': bson_1.Long.fromNumber(Date.now()),
                'ml': template.userLimit,
                'desc': template.description,
                'sc': template.searchable,
                'adid': (0, crypto_1.randomUUID)(),
                ...openlink_1.OpenLinkProfile.serializeLinkProfile(profile)
            };
            const res = await this._session.request('CREATELINK', reqData);
            if (res.status !== request_1.KnownDataStatusCode.SUCCESS || !res.chatRoom)
                return { status: res.status, success: false };
            return { success: true, status: res.status, result: { channelId: res.chatRoom.chatId, linkId: res.ol.li } };
        }
        async createOpenDirectChannel(template, profile) {
            const reqData = {
                'ri': bson_1.Long.fromNumber(Date.now()),
                'ln': template.linkName,
                'ptp': 1,
                'lip': 'p:tagKg\/wkFJvb3KUT\/lkdWRmhRrNA9SJIet4gaw1',
                'lt': openlink_1.OpenLinkType.PROFILE,
                'aptp': !template.mainProfileOnly,
                'desc': template.description,
                'sc': template.searchable,
                'adid': (0, crypto_1.randomUUID)(),
            };
            const res = await this._session.request('CREATELINK', reqData);
            if (res.status !== request_1.KnownDataStatusCode.SUCCESS)
                return { status: res.status, success: false };
            return {
                success: true, status: res.status,
                result: { openLink: (0, struct_1.structToOpenLink)(res.ol), info: (0, struct_1.structToOpenLinkInfo)(res.ol) }
            };
        }
        // TODO::
        async createOpenProfile(template) {
            const reqData = {
                'ri': bson_1.Long.fromNumber(Date.now()),
                'ln': template.linkName,
                'ptp': 2,
                'nn': template.linkName,
                'pp': 'p:tagKg\/wkFJvb3KUT\/lkdWRmhRrNA9SJIet4gaw1',
                'lt': openlink_1.OpenLinkType.PROFILE,
                "did": 40,
                'aptp': !template.mainProfileOnly,
                'desc': "",
                'sc': template.searchable,
                "pfc": `{\"description\": \"${template.description}\", \"tags\": \"${template.tags}\"}`,
                'adid': (0, crypto_1.randomUUID)(),
            };
            const res = await this._session.request('CREATELINK', reqData);
            if (res.status !== request_1.KnownDataStatusCode.SUCCESS)
                return { status: res.status, success: false };
            return {
                success: true, status: res.status,
                result: { openLink: (0, struct_1.structToOpenLink)(res.ol), info: (0, struct_1.structToOpenLinkInfo)(res.ol) }
            };
        }
        async updateOpenLink(link, settings) {
            const reqData = {
                'li': link.linkId,
                'ln': settings.linkName,
                'ac': settings.activated,
                'pa': true,
                'pc': settings.passcode || '',
                'desc': settings.description,
                'sc': settings.searchable
            };
            if ('directLimit' in settings) {
                reqData['dcl'] = settings.directLimit;
            }
            if ('userLimit' in settings) {
                reqData['ml'] = settings.userLimit;
            }
            if (settings.linkCoverURL) {
                reqData['lip'] = settings.linkCoverURL;
            }
            const res = await this._session.request('UPDATELINK', reqData);
            if (res.status !== request_1.KnownDataStatusCode.SUCCESS)
                return { status: res.status, success: false };
            return {
                success: true,
                status: res.status,
                result: {
                    openLink: (0, struct_1.structToOpenLink)(res.ol),
                    info: (0, struct_1.structToOpenLinkInfo)(res.ol)
                }
            };
        }
    }
    exports.TalkOpenLinkSession = TalkOpenLinkSession;
});
//# sourceMappingURL=talk-open-link-session.js.map