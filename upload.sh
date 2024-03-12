#!/bin/sh

[ -f .env ] && . ./.env
[ -z "$DOMAIN" ] && DOMAIN=fa.mpeschel10.com
echo "Assuming domain name is $DOMAIN"
SSH_ROOT="root@$DOMAIN"

check_doctl_exists() {
    echo "Checking if doctl installed..."
    doctl -h >/dev/null || {
        echo "You do not seem to have doctl installed."
        echo "Follow the instructions here to install it: https://docs.digitalocean.com/reference/doctl/how-to/install/"
        exit 2
    }
}

check_doctl_logged_in() {
    echo "Checking if doctl is logged in..."
    doctl account get 2>&1 >/dev/null || {
        [ -z "$DOCTL_AUTH_TOKEN" ] && {
            echo "Are you logged in?"
            echo "You must get an auth token from Digital Ocean."
            echo ""
            echo "Go to https://mail.google.com"
            echo "Username is facialanalytics@gmail.com"
            echo "Password is a secret you must ask someone for"
            echo "    Possibly ask mpeschel10@gmail.com, assuming nobody changes it while I'm gone"
            echo ""
            echo "Go to https://cloud.digitalocean.com/login"
            echo "Click sign in with Google and select the facialanalytics@gmail.com email address"
            echo ""
            echo "Go to https://cloud.digitalocean.com/account/api/tokens"
            echo "Click ceate new token"
            echo "Name it Jeff or something"
            echo "Click the \"Write\" permission checkbox"
            echo "Click Generate Token"
            echo "Click the copy button next to the token."
            echo "    The token should look like dop_v1_3505ba2d6a35e9455ea0c8f295114f5831e1951526fa54c25fbee88bcd0b875e"

            echo ""
            echo "Then run the following command:"
            echo "doctl auth init -t dop_v1_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
            echo "Except replace the example token with your actual token"
            echo "Then run this script again."

            exit 3
        } || {
            echo "Attempting to sign in with DOCTL_AUTH_TOKEN..."
            doctl auth init -t "$DOCTL_AUTH_TOKEN"
        }
    }
}

ensure_project_id() {
    1>&2 echo "Checking if facial-analytics project exists..."
    PROJECT_ID=$(doctl projects list --format Name,ID --no-header |
        grep "facial-analytics " |
        sed "s/facial-analytics\s*//"
    )

    [ -z "$PROJECT_ID" ] && {
        1>&2 echo "Creating new facial-analytics project..."
        PROJECT_ID=$(doctl projects create\
            --name facial-analytics\
            --purpose "Mobile Application"\
            --description "Back-end and website for iOS Application for Grading Facial Paralysis Outcomes"\
            --environment "Production"\
            --format ID\
            --no-header
        )
    }
    echo "$PROJECT_ID"
}

ensure_local_ssh_key() {
    mkdir -p secrets
    KEY_PATH="secrets/$SSH_ROOT"
    [ ! -e "$KEY_PATH" ] && {
        1>&2 echo "You do not have an ssh key."
        1>&2 echo "To control the \"droplet\" virtual server (upload files and start the server etc.) you must create an ssh key".
        ssh-keygen -f "$KEY_PATH"
        doctl compute ssh-key import "$HOSTNAME-facial-analytics-key" --public-key-file "$KEY_PATH.pub"
    }
    echo "$KEY_PATH"
}

ensure_droplet_id() {
    1>&2 echo "Getting id of droplet server..."
    DROPLET_ID=$(doctl projects resources list "$PROJECT_ID" --no-header --format URN |
        grep "do:droplet:" |
        sed "s/do:droplet://"
    )

    [ $(echo "$DROPLET_ID" | wc -l) -gt 1 ] && {
        doctl projects resources list "$PROJECT_ID"
        1>&2 echo "You have multiple droplets (virtual servers) associated with the facial-analytics project."
        1>&2 echo "If that is intentional, this script is not designed to handle it and should be rewritten."
        1>&2 echo "If that is not intentional, destroy all the droplets and run this script again."
        exit 4
    }

    if [ -z "$DROPLET_ID" ]; then
        1>&2 echo "You have no live servers."
        1>&2 echo "Instantiating a new server..."
        1>&2 echo "Getting id of our ssh key..."
        FINGERPRINT=$(ssh-keygen -l -E md5 -f secrets/root\@fa.mpeschel10.com.pub | sed "s/.*MD5:\([0123456789abcdef:]*\) .*/\1/")
        function get_key_id {
            # echo "Looking for $FINGERPRINT"
            # doctl compute ssh-key list --format FingerPrint,ID --no-header
            doctl compute ssh-key list --format FingerPrint,ID --no-header | grep "$FINGERPRINT " | sed "s/$FINGERPRINT\s*//"
        }
        KEY_ID=$(get_key_id)

        1>&2 echo "Getting available operating systems..."
        function get_latest_debian {
            doctl compute image list --public --no-header --format "Public,Type,Distribution,Slug" |
            grep "true\s*base\s*Debian" |
            sort -r |
            head -n 1 |
            sed "s/true\s*base\s*Debian\s*//"
        }
        OS_SLUG=$(get_latest_debian)

        1>&2 echo "Getting available server sizes..."
        function get_second_cheapest {
            doctl compute size list --no-header --format "Price Hourly",Slug |
            sort |
            head -n 2 |
            tail -n 1 |
            sed "s/[0-9]*\.[0-9]*\s*//"
        }
        SIZE_SLUG=$(get_second_cheapest)

        1>&2 echo "Getting available regions..."
        function get_nyc_region {
            doctl compute region list --no-header --format Available,Slug |
            grep "^true" |
            grep "nyc" |
            tail -n 1 |
            sed "s/true\s*//"
        }
        REGION_SLUG=$(get_nyc_region)

        [ -z "$OS_SLUG" ] && OS_SLUG=debian-12-x64
        [ -z "$SIZE_SLUG" ] && SIZE_SLUG=s-1vcpu-1gb
        [ -z "$REGION_SLUG" ] && REGION_SLUG=nyc3

        1>&2 echo "Creating droplet to host the facial-analytics server (this takes a minute)..."
        DROPLET_ID=$(doctl compute droplet create facial-analytics-server\
            --project-id "$PROJECT_ID" --droplet-agent=true --ssh-keys "$KEY_ID"\
            --image "$OS_SLUG" --size "$SIZE_SLUG" --region "$REGION_SLUG"\
            --wait\
            --no-header --format ID)
    fi
    echo "$DROPLET_ID"
}

ensure_droplet_exists() {
    check_doctl_exists
    check_doctl_logged_in

    PROJECT_ID=$(ensure_project_id)
    echo "facial-analytics project ID is $PROJECT_ID."

    DROPLET_ID=$(ensure_droplet_id)
    echo "facial-analytics droplet ID is $DROPLET_ID"
}

get_ip() {
    doctl compute droplet get "$1" --no-header --format "Public IPv4"
}

ensure_can_ssh() {
    ssh -i "$KEY_PATH" -F ssh_config "$SSH_ROOT" "echo Access granted." && return
    ensure_droplet_exists
    
    ssh -i "$KEY_PATH" -F ssh_config "$SSH_ROOT" "echo Access granted." && return
    DROPLET_IP=$(get_ip "$DROPLET_ID")
    SSH_ROOT="root@$DROPLET_IP"
    ssh -i "$KEY_PATH" -F ssh_config "$SSH_ROOT" "echo Access granted." && {
        echo ""
        echo "WARNING:"
        echo "It looks like your domain name does not point to this droplet (possibly because the droplet is new)."
        echo "You should fix that."
        echo "The droplet's IPv4 address is $DROPLET_IP"
        echo "Go to your domain registrar and paste that IPv4 address in the \"A\" record for your domain name."
        echo ""
        return
    }
    
    echo "ERROR:"
    echo "A droplet virtual private server exists, but I cannot sign into it with your key."
    echo "You will have to manually install your ssh key on the server."
    echo "Go to https://cloud.digitalocean.com/projects/"
    echo "Click on the facial-analytics project in the left sidebar."
    echo "Click on the facial-analytics-server Droplet."
    echo "Click on Access in the inner left sidebar."
    echo "Click Launch Droplet Console."
    echo "Type 'nano .ssh/authorized_keys'"
    echo "Press enter to confirm."
    echo "Paste the contents of ${KEY_PATH}.pub in as the first line of that file."
    echo "    (Try ctrl + shift + v or use the right-click menu)"
    echo "    (You may need to press the enter key. Make sure the entire thing is on its own line)"
    echo "Press ctrl + x (maybe command + x on mac?) to exit"
    echo "Press y to save"
    echo "Press enter to confirm"
    echo "Then run this script again. Hopefully, you should not get this message a second time."
    exit 5
}


remote() {
    ssh -i "$KEY_PATH" -F ssh_config "$SSH_ROOT" $1
}

main() {
    KEY_PATH=$(ensure_local_ssh_key)
    ensure_can_ssh
    
    echo "Setting up our repo to talk to the droplet server..."
    git config core.sshCommand "ssh -i '$KEY_PATH' -F ssh_config"
    [ -z "$(git remote -v | grep facial-analytics)" ] && git remote add facial-analytics "ssh://$SSH_ROOT:/opt/facial-analytics"
    
    echo "Confirming git, nodejs, and nginx are all installed..."
    remote "nginx -version && git --version && node --version || (apt-get update && apt-get upgrade && apt-get install nginx nodejs git)"

    echo "Confirming remote repo is present and ready..."
    remote "mkdir -p /opt/facial-analytics"
    remote "cd /opt/facial-analytics && [ ! -e .git ] && git init"
    remote "cd /opt/facial-analytics && [ -z '\$(git branch | grep main)' ] && git branch -m main"
    remote "cd /opt/facial-analytics && [ -z '\$(git branch | grep deploy)' ] && git checkout main && git checkout -b deploy"

    echo "Attempting merge-push."
    echo "If git pull fails, you will have to manually finish merging the remote main into your main, then run this script again."
    OLD_BRANCH=$(git branch --show-current)
    [ "$OLD_BRANCH" == main ] || {
        git checkout main && git pull facial-analytics main && git merge "$OLD_BRANCH"
    } && {
        git push facial-analytics main
    }
    git checkout "$OLD_BRANCH"
    
    remote "rm -f /etc/nginx/sites-enabled/default"
    remote "[ -e /etc/nginx/sites-enabled/facial-analytics.conf ] || ln -s /opt/facial-analytics/deploy/facial-analytics.conf /etc/nginx/sites-enabled/facial-analytics.conf"
    remote "nginx -t && nginx -s reload"
}

main
