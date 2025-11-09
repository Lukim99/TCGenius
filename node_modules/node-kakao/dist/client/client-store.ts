import { Long } from "bson";
import { NormalChannelData } from "../channel";
import { OpenChannelData } from "../openlink";
import { ChatSessionInfo } from "./client-session";

interface StagedSessionInfo {
    
}

export interface ClientSessionInfo {
    session: ChatSessionInfo;
    channelInfos: Array<NormalChannelData | OpenChannelData>;
}

interface ClientNormalChannelData {

}
