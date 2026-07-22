'use strict';

const PUBLIC_ROOMS = Object.freeze([
    { id: 'public-1', name: '자유 채팅 1' },
    { id: 'public-2', name: '자유 채팅 2' },
    { id: 'public-3', name: '자유 채팅 3' },
    { id: 'public-4', name: '자유 채팅 4' },
    { id: 'public-5', name: '자유 채팅 5' }
]);

class WebChatError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function createWebChat(options) {
    const opts = options || {};
    const onChat = opts.onChat || (async () => false);
    const getUserByName = opts.getUserByName || (async () => null);
    const now = opts.now || Date.now;
    const maxMessages = Number(opts.maxMessages || 200);
    const minIntervalMs = Number(opts.minIntervalMs == null ? 500 : opts.minIntervalMs);
    const rooms = new Map();
    const channels = new Map();
    const subscribers = new Map();
    const lastSentAt = new Map();
    let nextMessageId = 1;

    function resolveRoom(roomId, user) {
        const publicIndex = PUBLIC_ROOMS.findIndex(room => room.id === roomId);
        if (publicIndex >= 0) {
            return {
                id: roomId,
                key: roomId,
                name: PUBLIC_ROOMS[publicIndex].name,
                channelId: 'web-chat:public:' + (publicIndex + 1),
                private: false
            };
        }
        if (roomId === 'me') {
            if (!user || user.id == null) throw new WebChatError(401, '로그인이 필요합니다.');
            const stableId = String(user.id);
            return {
                id: 'me',
                key: 'private:' + stableId,
                name: 'RPGenius 개인 채팅',
                channelId: 'web-chat:private:' + stableId,
                private: true
            };
        }
        throw new WebChatError(404, '존재하지 않는 채팅방입니다.');
    }

    function roomMessages(key) {
        if (!rooms.has(key)) rooms.set(key, []);
        return rooms.get(key);
    }

    function emit(room, message) {
        const listeners = subscribers.get(room.key);
        if (!listeners) return;
        for (const listener of Array.from(listeners)) listener(message);
    }

    function addMessage(room, sender, text) {
        const message = {
            id: String(nextMessageId++),
            roomId: room.id,
            sender: { id: String(sender.id), name: String(sender.name), type: sender.type || 'user' },
            text: String(text),
            createdAt: now()
        };
        const messages = roomMessages(room.key);
        messages.push(message);
        if (messages.length > maxMessages) messages.splice(0, messages.length - maxMessages);
        emit(room, message);
        return message;
    }

    function getChannel(room) {
        if (channels.has(room.key)) return channels.get(room.key);
        const channel = {
            channelId: room.channelId,
            sendChat(text) {
                return Promise.resolve(addMessage(room, { id: 'rpgenius', name: 'RPGenius', type: 'bot' }, text));
            },
            sendMedia() {
                return this.sendChat('이 채팅에서는 미디어 전송을 지원하지 않습니다.');
            }
        };
        channels.set(room.key, channel);
        return channel;
    }

    function history(roomId, user, options) {
        const room = resolveRoom(roomId, user);
        const query = options || {};
        const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
        const messages = roomMessages(room.key);
        let end = messages.length;
        if (query.before != null && query.before !== '') {
            const index = messages.findIndex(message => message.id === String(query.before));
            if (index < 0) throw new WebChatError(400, '기준 메시지를 찾을 수 없습니다.');
            end = index;
        }
        return { room: { id: room.id, name: room.name, private: room.private }, messages: messages.slice(Math.max(0, end - limit), end) };
    }

    function subscribe(roomId, user, listener) {
        const room = resolveRoom(roomId, user);
        let listeners = subscribers.get(room.key);
        if (!listeners) {
            listeners = new Set();
            subscribers.set(room.key, listeners);
        }
        listeners.add(listener);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            listeners.delete(listener);
            if (!listeners.size) subscribers.delete(room.key);
        };
    }

    function validateText(text) {
        if (typeof text !== 'string' || !text.trim()) throw new WebChatError(400, '메시지를 입력해주세요.');
        if (text.length > 500) throw new WebChatError(400, '메시지는 500자 이하로 입력해주세요.');
        return text.trim();
    }

    function sendMessage(roomId, user, rawText) {
        const room = resolveRoom(roomId, user);
        const text = validateText(rawText);
        const senderKey = String(user.id);
        const sentAt = now();
        const previous = lastSentAt.get(senderKey);
        if (previous != null && sentAt - previous < minIntervalMs) throw new WebChatError(429, '메시지는 0.5초 간격으로 전송해주세요.');
        lastSentAt.set(senderKey, sentAt);
        const message = addMessage(room, { id: senderKey, name: user.name, type: 'user' }, text);
        const senderId = 'web:' + senderKey;
        const sessionName = String(user.name);
        const data = {
            text,
            getSenderInfo: () => ({ userId: senderId, nickname: sessionName }),
            _chat: { sender: { userId: senderId, nickname: sessionName } }
        };
        const context = {
            isWeb: true,
            queueKey: 'account:' + senderKey,
            getUser: () => getUserByName(sessionName)
        };
        Promise.resolve(onChat(data, getChannel(room), context)).catch(error => {
            console.error('[webchat] RPG command error:', error);
            getChannel(room).sendChat('명령을 처리하는 중 오류가 발생했습니다.');
        });
        return message;
    }

    return {
        PUBLIC_ROOMS,
        history,
        subscribe,
        sendMessage,
        resolveRoom,
        getChannel,
        __test: { rooms, channels, subscribers }
    };
}

module.exports = { PUBLIC_ROOMS, WebChatError, createWebChat };
