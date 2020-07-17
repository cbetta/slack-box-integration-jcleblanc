const boxSDK = require("box-node-sdk");
const config = require("./config.js");
const express = require("express");
const app = express();
const axios = require("axios");
const path = require("path");
const util = require("util");
const fs = require("fs");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const configJSON = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "./config.json"))
);
const sdk = boxSDK.getPreconfiguredInstance(configJSON);
const client = sdk.getAppAuthClient("enterprise");

app.post("/event", (req, res) => {
  if (req.body.token !== config.verificationToken) {
    res.send("Slack Verification Failed");
  }

  handler.process(res, req.body);
});

const handler = (() => {
  function process(res, data) {
    let userId;

    if (data.type && data.type === "event_callback") {
      const eventType = data.event.type;
      const channel = data.event.channel;
      userId = data.event.user;

      getSlackUser(userId, function (user) {
        processUser(user, eventType, channel);
      });

      res.send();
    } else if (data.command && data.command === "/boxadd") {
      textOptions = data.text.split(" ");
      if (
        ["file", "folder"].indexOf(textOptions[0]) >= 0 &&
        isNaN(textOptions[1]) === false
      ) {
        userId = data.user_id;

        getSlackUser(userId, function (user) {
          processContent(user, data.channel_id, textOptions[0], textOptions[1]);
        });
        res.send("Adding content");
      } else {
        res.send("Invalid input. Example usage: /boxadd file 123456");
      }
    } else {
      res.send("Invalid action");
    }
  }

  function processUser(user, event, channel) {
    getGroupId(channel, function (gid) {
      // if bot was added, add all channel users
      if (user.is_bot === true) {
        processSlackChannel(channel, gid);
      } else if (
        user.profile &&
        user.profile.email &&
        event === "member_joined_channel"
      ) {
        addGroupUser(gid, user.profile.email);
      } else if (
        user.profile &&
        user.profile.email &&
        event === "member_left_channel"
      ) {
        removeGroupUser(gid, user.profile.email);
      }
    });
  }

  function addGroupUser(groupId, email) {
    client.enterprise.getUsers({ filter_term: email }).then((users) => {
      if (users.entries.length > 0) {
        const userId = users.entries[0].id;
        const groupRole = client.groups.userRoles.MEMBER;

        client.groups
          .addUser(groupId, userId, { role: groupRole })
          .then((membership) => {
            if (membership.id) {
              console.log(`Member added with membership ID: ${membership.id}`);
            } else {
              console.log(`Member not added`);
            }
          })
          .catch(function (err) {
            console.log(err.response.body);
          });
      } else {
        console.log("No Box user found to add to group");
      }
    });
  }

  function removeGroupUser(groupId, email) {
    client.enterprise.getUsers({ filter_term: email }).then((users) => {
      if (users.entries.length > 0) {
        const userId = users.entries[0].id;
        const groupRole = client.groups.userRoles.MEMBER;

        client.groups
          .addUser(groupId, userId, { role: groupRole })
          .then((membership) => {
            if (membership.id) {
              console.log(`Member added with membership ID: ${membership.id}`);
            } else {
              console.log(`Member not added`);
            }
          })
          .catch(function (err) {
            console.log(err.response.body);
          });
      } else {
        console.log("No Box user found to add to group");
      }
    });
  }

  function processContent(user, channel, type, fid) {
    getGroupId(channel, function (gid) {
      const email = user.profile.email;

      client.enterprise.getUsers({ filter_term: email }).then((users) => {
        if (users.entries.length > 0) {
          client.asUser(users.entries[0].id);
          const collabRole = client.collaborationRoles.VIEWER;
          const collabOptions = { type: type };

          client.collaborations
            .createWithGroupID(gid, fid, collabRole, collabOptions)
            .then((collaboration) => {
              console.log(
                `Content added with collaboration ID ${collaboration.id}`
              );
            })
            .catch(function (err) {
              console.log(
                util.inspect(err.response.body, {
                  showHidden: false,
                  depth: null,
                })
              );
            });
        }
      });
    });
  }

  function processSlackChannel(channel, gid) {
    const limit = 100;
    const channelUsersPath = `https://slack.com/api/conversations.members?token=${config.botToken}&channel=${channel}&limit=${limit}`;
    let userPath = "";

    axios.get(channelUsersPath).then((response) => {
      response.data.members.forEach((uid) => {
        getSlackUser(uid, function (user) {
          if (user.profile.email && user.is_bot === false) {
            addGroupUser(gid, user.profile.email);
          }
        });
      });
    });
  }

  function getSlackUser(userId, _callback) {
    const userPath = `https://slack.com/api/users.info?token=${config.botToken}&user=${userId}`;

    axios.get(userPath).then((response) => {
      if (response.data.user && response.data.user.profile) {
        _callback(response.data.user);
      } else {
        console.log("No user data found");
      }
    });
  }

  function getGroupId(groupName, _callback) {
    let groupId = 0;

    client.groups.getAll().then((groups) => {
      for (let i = 0; i < groups.entries.length; i++) {
        if (groups.entries[i].name === groupName) {
          groupId = groups.entries[i].id;
          break;
        }
      }

      if (groupId === 0) {
        client.groups
          .create(groupName, {
            description: "Slack channel collaboration group",
            invitability_level: "all_managed_users",
          })
          .then((group) => {
            groupId = group.id;
            _callback(groupId);
          });
      } else {
        _callback(groupId);
      }
    });
  }

  return {
    process,
  };
})();

const port = process.env.PORT || 3000;
app.listen(port, function (err) {
  console.log("Server listening on PORT", port);
});
