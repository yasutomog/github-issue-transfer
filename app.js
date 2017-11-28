'use strict'

const rp = require('request-promise');
const fs = require("fs");
const async = require('async');

// issueの移行元と移行先
const repoCnf = {
    src: {
        owner: 'owner1',
        repName: 'repositoryName1'
    },
    dst: {
        owner: 'owner2',
        repName: 'repositoryName2'
    }
};

// githubのAPIトークン（key:userName / value:token）
const users = {
    user1: 'user1token',
    user2: 'user2token',
    user3: 'user3token'
};

const defUserName = 'user1';

// stop timeout 310, 899
const retryIssueNum = 899;

// milestone（key:title / value:number）
// issue登録時にmilestoneはnumberが必要になるため
let milestoneNumber = {};

/**
 * ページ毎にissueを取得（githubのAPIの仕様で1ページ最大30件）
 *
 * @param pageNum issueのページ数
 */
const getIssues = (pageNum) => {

    let options = {

        uri: 'https://api.github.com/repos/' + repoCnf.src.owner + '/' + repoCnf.src.repName + '/issues',
        method: 'GET',
        timeout: 600 * 1000,
        qs: {
            access_token: users[repoCnf.src.owner],
            state: 'all',
            sort: 'created',
            direction: 'asc',
            page: pageNum
        },
        resolveWithFullResponse: true,
        headers: {
            'User-Agent': 'Request-Promise',
            'Accept': 'application/vnd.github.v3+json'
        }
    };

    rp(options).then((res) => {

        let hasNext = false;
        let link = res.headers.link;
        if (link && link.indexOf('next') > -1) {
            hasNext = true;
        }

        // APIで取得したissueデータをファイル出力
        let body = res.body;
        let fName = 'issue' + pageNum + '.json';
        fs.writeFile(fName, body);

        let issues = JSON.parse(body);
        procByIssuePage(pageNum, issues, hasNext);

    }).catch((err) => {

        console.log(err);

    });

};

const getComments = (commentUrl) => {

    let options = {
        uri: commentUrl,
        method: "GET",
        timeout: 600 * 1000,
        qs: {
            access_token: users[repoCnf.src.owner]
        },
        headers: {
            'User-Agent': 'Request-Promise',
            'Accept': 'application/vnd.github.v3+json'
        }
    };

    return rp(options);

};

const postIssue = (issue) => {

    console.log(issue.title);

    let title = issue.title;
    if (issue.pull_request) {
        title = title + '(移行前はプルリクエスト)'
    }

    let assignees = [];
    issue.assignees.forEach((assignee) => {

        // 移行先のリポジトリに存在しないユーザはアサインしない
        let uName = assignee.login;
        if (users[uName]) {
            assignees.push(uName);
        }

    });

    let milestone = null;
    if (issue.milestone) {
        milestone = issue.milestone.title;
    }

    let labels = [];
    issue.labels.forEach((label) => {
        labels.push(label.name);
    });

    let aToken = getAccessToken(issue.user.login);
    let options = {
        method: 'POST',
        timeout: 600 * 1000,
        uri: 'https://api.github.com/repos/' + repoCnf.dst.owner + '/' + repoCnf.dst.repName + '/issues',
        qs: {
            access_token: aToken
        },
        json: {
            title: title,
            body: issue.body,
            assignees: assignees,
            milestone: milestoneNumber[milestone],
            labels: labels
        },
        headers: {
            'User-Agent': 'Request-Promise'
        }
    };

    return rp(options);

};

const editIssue = (issueNum, issue) => {

    let aToken = getAccessToken(issue.user.login);
    let options = {
        method: 'POST',
        timeout: 600 * 1000,
        uri: 'https://api.github.com/repos/' + repoCnf.dst.owner + '/' + repoCnf.dst.repName + '/issues/' + issueNum,
        qs: {
            access_token: aToken
        },
        json: {
            state: issue.state
        },
        headers: {
            'User-Agent': 'Request-Promise'
        }
    };

    return rp(options);

};

const postComment = (issueNum, cmt) => {

    let aToken = getAccessToken(cmt.user.login);
    let options = {
        method: 'POST',
        timeout: 600 * 1000,
        uri: 'https://api.github.com/repos/' + repoCnf.dst.owner + '/' + repoCnf.dst.repName + '/issues/' + issueNum + '/comments',
        qs: {
            access_token: aToken
        },
        json: {
            body: cmt.body
        },
        headers: {
            'User-Agent': 'Request-Promise',
            'Content-Type': 'application/json'
        }
    };

    return rp(options);

};

const getAccessToken = (userName) => {

    let aToken = users[userName];
    if (!aToken) {
        aToken = users[defUserName];
    }
    return aToken;

};

const procByIssuePage = (pageNum, issues, hasNext) => {

    async.eachSeries(issues, (issue, next1) => {

        let cmtUrl = issue.comments_url;
        let issueNum = issue.number;

        if (issueNum <= retryIssueNum) {
            // リトライ時のスキップ処理
            next1();
        } else {

            postIssue(issue).then((resIssue) => {

                issueNum = resIssue.number;

                return editIssue(issueNum, issue);

            }).then((resComments) => {

                return getComments(cmtUrl);

            }).then((resComments) => {

                // APIで取得したissueのcommentデータをファイル出力
                let comments = JSON.parse(resComments);
                let fName = 'comment' + pageNum + '-' + issueNum + '.json'
                fs.writeFile(fName, resComments);

                if (comments.length > 0) {

                    async.eachSeries(comments, (cmt, next2) => {

                        postComment(issueNum, cmt).finally(() => {

                            next2();

                        });

                    }, function(err) {

                        next1();

                    });

                } else {

                    next1();

                }

            }).catch((err) => {

                console.log(err);

            });

        }


    }, (err) => {

        if (hasNext) {
            // 次ページがある場合、次のページ処理を再帰的に処理する
            let p = pageNum + 1;
            getIssues(p);
        }

    });

};

const getMilestones = () => {

    // milestoneはページングする程データがないので、transformでレスポンスを変換
    let options = {
        uri: 'https://api.github.com/repos/' + repoCnf.src.owner + '/' + repoCnf.src.repName + '/milestones',
        method: "GET",
        timeout: 600 * 1000,
        qs: {
            access_token: users[repoCnf.src.owner],
            state: 'all'
        },
        transform: function (body) {
            return JSON.parse(body);
        },
        headers: {
            'User-Agent': 'Request-Promise',
            'Accept': 'application/vnd.github.v3+json'
        }
    };

    return rp(options);

};

const postMilestones = (milestones, callback) => {

    async.eachSeries(milestones, (ms, next) => {

        postMilestone(ms).finally(() => {
            next();
        });

    }, (err) => {

        callback(null, milestones);

    });

};

const postMilestone = (milestone) => {

    console.log(milestone.title);
    
    let aToken = getAccessToken(milestone.creator.login);
    let options = {
        method: 'POST',
        timeout: 600 * 1000,
        uri: 'https://api.github.com/repos/' + repoCnf.dst.owner + '/' + repoCnf.dst.repName + '/milestones',
        qs: {
            access_token: aToken
        },
        json: {
            title: milestone.title,
            state: milestone.state,
            description: milestone.description,
            due_on: milestone.due_on
        },
        headers: {
            'User-Agent': 'Request-Promise',
            'Content-Type': 'application/json'
        }
    };

    return rp(options);

};

const moveMilestones = (callback) => {

    getMilestones().then((milestones) => {

        postMilestones(milestones, callback);

    }).catch((err) => {

        console.log(err);

        callback(err, null);

    });

};


const getLabels = () => {

    // labelはページングする程データがないので、transformでレスポンスを変換
    let options = {
        uri: 'https://api.github.com/repos/' + repoCnf.src.owner + '/' + repoCnf.src.repName + '/labels',
        method: "GET",
        timeout: 600 * 1000,
        qs: {
            access_token: users[repoCnf.src.owner],
            state: 'all'
        },
        transform: function (body) {
            return JSON.parse(body);
        },
        headers: {
            'User-Agent': 'Request-Promise',
            'Accept': 'application/vnd.github.v3+json'
        }
    };

    return rp(options);

};

const postLabels = (labels, callback) => {

    async.eachSeries(labels, (label, next) => {

        postLabel(label).finally(() => {
            next();
        });

    }, (err) => {

        callback(null, labels);

    });

};

const postLabel = (label) => {

    console.log(label.name);
    
    let aToken = getAccessToken(defUserName);
    let options = {
        method: 'POST',
        timeout: 600 * 1000,
        uri: 'https://api.github.com/repos/' + repoCnf.dst.owner + '/' + repoCnf.dst.repName + '/labels',
        qs: {
            access_token: aToken
        },
        json: {
            name: label.name,
            color: label.color
        },
        headers: {
            'User-Agent': 'Request-Promise',
            'Content-Type': 'application/json'
        }
    };

    return rp(options);

};

const moveLabels = (callback) => {

    getLabels().then((labels) => {

        postLabels(labels, callback);

    }).catch((err) => {

        console.log(err);

        callback(err, null);

    });

};

const createMilestoneNumber = (callback) => {

    let options = {
        uri: 'https://api.github.com/repos/' + repoCnf.dst.owner + '/' + repoCnf.dst.repName + '/milestones',
        method: "GET",
        timeout: 600 * 1000,
        qs: {
            access_token: users[defUserName],
            state: 'all'
        },
        transform: function (body) {
            return JSON.parse(body);
        },
        headers: {
            'User-Agent': 'Request-Promise',
            'Accept': 'application/vnd.github.v3+json'
        }
    };

    rp(options).then((milestones) => {

        milestones.forEach((ms) => {
            milestoneNumber[ms.title] = ms.number;
        });

        callback(null, milestones);

    }).catch((err) => {

        console.log(err);
        callback(err, null);

    });

};

/**
 * For init
 * 1. milestoneのデータを移動
 * 2. labelのデータを移動
 * 3. issue登録用に移行先のmilestoneのnumberを取得
 * 4. issueを移動
 */
async.series([
    moveMilestones,
    moveLabels,
    createMilestoneNumber
], function (err, results) {
    getIssues(1);
});

/**
 * For retry
 * 前回タイムアウトからのリトライ時
 * 1. 前回失敗したissue番号を設定（retryIssueNum）
 * 2. getIssuesの引数に前回失敗時のissueページ数を設定
 */
// async.series([
//     createMilestoneNumber
// ], function (err, results) {
//     getIssues(30);
// });
