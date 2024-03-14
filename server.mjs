import { Server } from 'node:http';

const PORT = process.env.PORT ?? '17447';

function awfulReadAll(stream) {
    const chunks = [];
    return new Promise((resolve, reject) => {
        stream.on('data', data => chunks.push(data));
        stream.on('error', error => reject(error));
        stream.on('close', () => resolve(new Blob(chunks).text()));
        // Note that we are "resolving" on a Promise,
        //  but Promises unwrap Promises, so the awaiting function will get the contents of .text().
    });
}

new Server(async (req, res) => {
    console.log(req.method, req.url);
    const bodyString = await awfulReadAll(req);
    const bodyJSON = JSON.parse(bodyString);
    const { token, user }  = bodyJSON;

    // TODO
    // verify the token with admin sdk
    // create the user with appropriate role, email, password
    
    console.log("Request body:", bodyString);
    console.log("User object:", user);
    res.statusCode = 200;
    res.end('Ayo wass crackin\'');
}).listen(PORT);

