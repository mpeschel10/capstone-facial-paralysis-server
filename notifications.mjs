import { Expo } from 'expo-server-sdk';

// Create a new Expo SDK client
// optionally providing an access token if you have enabled push security
let expo = new Expo({
    // accessToken: process.env.EXPO_ACCESS_TOKEN,
    useFcmV1: false // this can be set to true in order to use the FCM v1 API
});

const uidToUserTokens = {};
const pushTokenToUserTokens = {}
// Where a "UserTokens" is an object whose keys are pushTokens for Expo push notifications.

export const notify = async (uid, message) => {
    const userTokens = uidToUserTokens[uid];
    if (!userTokens) return; // User has no logged in devices; do not notify.

    const pushTokens = Object.keys(userTokens);
    console.log(`Sending notification to user ${uid} on push tokens ${pushTokens}.`);
    const messages = pushTokens.map(
        pushToken => Object.assign({to: pushToken}, message)
    );
    // console.log('Messages is', messages);
    let chunks = expo.chunkPushNotifications(messages);
    const tickets = [];
    for (const chunk of chunks) {
        tickets.push(await expo.sendPushNotificationsAsync(chunk));
    }
    console.log('Sent messages:', tickets);
}

export const unregister = pushToken => {
    const userTokens = pushTokenToUserTokens[pushToken];
    if (!userTokens) return;
    
    delete userTokens[pushToken];
    delete pushTokenToUserTokens[pushToken];
}

export const register = (pushToken, uid) => {
    unregister(pushToken);

    let userTokens = uidToUserTokens[uid];
    if (!userTokens) {
        userTokens = {};
        uidToUserTokens[uid] = userTokens;
    }
    userTokens[pushToken] = true;
    pushTokenToUserTokens[pushToken] = userTokens;
}
