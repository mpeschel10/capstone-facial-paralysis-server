import { getMessaging } from 'firebase-admin/messaging';

export const getNotifications = (app) => {
    let messaging = getMessaging(app);
    const uidToUserTokens = {};
    const pushTokenToUserTokens = {}
    // Where a "UserTokens" is an object whose keys are pushTokens for push notifications.
    
    const notifications = {
        isValidToken: async token => {
            try {
                return (await messaging.send({token}, true)) === 'projects/facial-analytics-f8b9e/messages/fake_message_id';
            } catch (error) {
                if (error.code === 'messaging/invalid-argument') return false;
                else if (error.code === 'messaging/registration-token-not-registered')
                    return true;
                    // This error happens if you have a valid token that has been unregistered e.g. because the app has been uninstalled.
                    // Atm it's more useful to allow it to be registered anyway so we can keep testing;
                    // I think it's unlikely to be an actual error that someone is registering stale tokens.
                    // TODO make test that generates real token so we can correctly return error in this case.
                throw error;
            }
        },
        
        notify: async (uid, message) => {
            const userTokens = uidToUserTokens[uid];
            if (!userTokens) return; // User has no logged in devices; do not notify.
    
            const pushTokens = Object.keys(userTokens);
            const messages = pushTokens.map(
                pushToken => Object.assign({token: pushToken}, message)
            );

            console.log(`Sending notification to user ${uid} on push tokens ${pushTokens}.`);
            const results = await getMessaging().sendEach(messages);
            console.log('Message results:', JSON.stringify(results?.responses));
        },
        
        // Empty methods so my autocomplete hooks it. I wish I knew typescript...
        unregister: pushToken => {},
        register: (pushToken, uid) => {}
    };
    
    notifications.unregister = pushToken => {
        const userTokens = pushTokenToUserTokens[pushToken];
        if (!userTokens) return;
        
        delete userTokens[pushToken];
        delete pushTokenToUserTokens[pushToken];
        console.log(`After unregistering ${pushToken}, uidToUserTokens is now ${JSON.stringify(uidToUserTokens)}`);
    };

    notifications.register = (pushToken, uid) => {
        notifications.unregister(pushToken);

        let userTokens = uidToUserTokens[uid];
        if (!userTokens) {
            userTokens = {};
            uidToUserTokens[uid] = userTokens;
        }
        userTokens[pushToken] = true;
        pushTokenToUserTokens[pushToken] = userTokens;
        console.log(`After registering ${pushToken} to ${uid}, uidToUserTokens is now ${JSON.stringify(uidToUserTokens)}`);
    };

    return notifications;
};
