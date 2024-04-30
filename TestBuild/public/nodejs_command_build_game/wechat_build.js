const https = require('https');
const http = require('http');
const archiver = require('archiver');
const ftp = require('ftp');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

/// -----------

// 服务器配置
const config = {
    official: {
        httpUrl: "https//:www.xxx.com/",
        remoteUrl: "https:/xxxxxxx/static/remotePackages/",
    },
    pretest: {
        httpUrl: "https://xxx.com/",
        remoteUrl: "https://xxx.com/static/remotePackages/",
    },
}

// 远程的文件存储路径
const remotePathConfig = "/xxxx/xxxx2/remotePackages/";

/**
 * FTP 账号密码(不建议直接填写, 而是通过外部文件读取, 具体查看文档或者搜索本变量)
 *  根据本地文件进行读取, 该文件被 git 忽略, 请自行创建, 格式如下. 文件名: wechat_password.json (可以直接复制修改 wechat_password_template.json)
 */
let userPassword = {
    "host": "192.168.xxx.xxx",
    "port": 7456,
    "user": "account",
    "password": "yourPassword"
}


let buildTime = 0;
let uploadTime = 0;

/// -----------
main();

async function main() {
    let timeMark1 = new Date().getTime();
    buildTime = uploadTime = 0;

    const { version, environment, isOfficial, cocosEditPath, test, retainSubPackages } = await getParam();

    // 校验版本号
    if (!version || !environment) {
        console.error('请提供版本号和环境.');
        process.exit(1);
    }

    // 确定服务器前缀
    const HttpRemoteServe = config[environment]["remoteUrl"];
    const HttpTool = config[environment]["httpUrl"];
    if (!HttpRemoteServe) {
        console.error('无效的环境.');
        process.exit(1);
        return;
    }

    // 确定 ftp 账号密码
    let temp = userPassword = await readPasswordConfigJson();
    if (!temp) {
        console.error('ftp服务器配置错误.');
        process.exit(1);
        return;
    }

    // 读取本地json, 进行修改
    const outName = await readBuildConfigJson({ HttpRemoteServe, version });

    // 构建
    const buildResult = await buildProject({ outName, cocosEditPath, test });
    if (!buildResult) { return; }
    // 压缩本地远程包, 上传到对应路径, 完毕后删除本地 zip, remote 文件夹. 通知服务端进行解压并删除 zip
    const localPath = path.join(__dirname, `./../../build/${outName}/remote`);
    const zipPath = path.join(__dirname, `./../../build/${outName}/remote.zip`);
    // 创建 zip 文件
    await zipDirectory(localPath, zipPath);

    /// ----------------------
    // 执行上传解压方式, 下方使用 [FTP版本] , 如果使用其他远端, 请自行修改上传解压方式

    // 连接到 FTP 服务器后进行上传解压
    console.log("连接到 FTP 服务器后进行上传解压");
    const client = new ftp();
    client.on('ready', async () => {
        console.log('成功连接 FTP server.');

        // 创建远程文件夹路径
        const remoteFolderPath = `${remotePathConfig}${version}`;
        const remotePath = `${remoteFolderPath}/remote.zip`;
        await new Promise((resolve, rejects) => {
            client.mkdir(remoteFolderPath, true, (err) => {
                if (err) {
                    console.error('创建远端文件夹失败了:', err);
                    rejects();
                    return;
                }
                resolve();
            });
        });

        // 进行 zip 上传
        await new Promise((resolve, rejects) => {
            let timer = setInterval(() => { uploadTime += 5; console.warn(`上传中, 当前耗时: ${uploadTime}秒...`) }, 5 * 1000);
            client.put(zipPath, remotePath, (err) => {
                clearInterval(timer);
                if (err) {
                    console.error('Error uploading zip file:', err);
                    rejects();
                    return;
                }

                console.log('Zip file uploaded successfully.');
                // 关闭 FTP 连接
                resolve();
            });
        });

        // 选择性保留本地子包文件
        if (retainSubPackages) {
            console.warn("保留本地子包文件, 未进行删除");
        } else {
            // 删除本地 zip 文件
            fs.unlink(zipPath, (err) => {
                if (err) {
                    console.error('Error deleting local zip file:', err);
                } else {
                    console.log('删除子包 zip.');
                }
            });
            // 删除本地 remote 文件夹
            fs.rm(localPath, { recursive: true, force: true }, (err) => {
                if (err) {
                    console.error('Error deleting local folder:', err);
                } else {
                    console.log('删除子包文件夹.');
                }
            });
        }


        // 调用服务器接口解压 zip 文件
        //TODO FTP 无法执行 unzip 解压命令, 所以需要通知服务器进行解压
        sendHttpsPostRequest(`${HttpTool}xxx`, {
            filepath: `${remotePathConfig}${version}/remote.zip`,
        }).then((response) => {
            console.log('HTTP POST请求成功:', response);
        }).catch((error) => {
            console.error('HTTP POST请求失败:', error);
        });

        // 删除远程 zip 文件
        // if (response.code == 1) {
        //     client.delete(remotePath, (err) => {
        //         if (err) {
        //             console.error('Error deleting remote zip file:', err);
        //         } else {
        //             console.log('Remote zip file deleted.');
        //         }
        //     });
        // }

        const spendTime = (new Date().getTime() - timeMark1) / 1000;
        console.warn(`构建上传完整耗时: ${spendTime} 秒(构建 ${buildTime} 秒, 上传 ${uploadTime} 秒). \n版本号: ${version}, \n环境: ${environment}`);


        client.end();
    });
    // 连接到 FTP 服务器
    client.connect(userPassword);

}

/** 测试使用, 方便构建某部分上传之类的 */
async function testOperate({ test, outName }) {
    if (test == "testDelete") {
        const parentFolder = path.join(__dirname, `./../../build/${outName}/remote`); // 项目相对路径
        const userBundleArr = ["subpackages"];   // 不在该数组内, 将会被删除
        await new Promise((resolve) => {
            fs.readdir(parentFolder, (err, files) => {
                if (err) {
                    console.error('Error reading directory:', err);
                    return;
                }
                files.forEach(file => {
                    if (!(!userBundleArr.includes(file) && fs.lstatSync(path.join(parentFolder, file)).isDirectory())) { return; }
                    fs.rm(path.join(parentFolder, file), { recursive: true, force: true }, (err) => {
                        if (err) {
                            console.error("Error deleting file:", err);
                            return;
                        }
                        console.log("File deleted successfully:", file);
                    });
                });

                setTimeout(() => { resolve(true); }, 2000);
            });
        });
    }
}

// 获取输入的参数
async function getParam() {
    // 获取命令行参数
    const args = process.argv.slice(2);
    let pCocosPath = "--cocosEditPath=";
    let pTest = "--test=";
    let pVersion = "version=";
    let pEnv = "environment=";
    let retainSubPackagesStr = "retainSubPackages=";

    // 解析参数
    let cocosEditPath = null;
    let test = null;
    let version = null;
    let environment = null;
    let retainSubPackages = null;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith(pCocosPath)) { cocosEditPath = arg.split('=')[1] || ""; continue; }
        if (arg.startsWith(pTest)) { test = arg.split('=')[1] || ""; continue; }
        if (arg.startsWith(pVersion)) { version = arg.split('=')[1] || ""; continue; }
        if (arg.startsWith(pEnv)) { environment = arg.split('=')[1] || ""; continue; }
        if (arg.startsWith(retainSubPackagesStr)) { retainSubPackages = arg.split('=')[1] || ""; continue; }
    }
    let isOfficial = environment == "official";
    console.warn({ cocosEditPath, test, version, environment, isOfficial, retainSubPackages });

    // 确认上传校验
    let inputResult = await new Promise((resolve) => {
        rl.question(`当前版本: ${version}, 当前环境: ${environment}, 是否继续? (input Y or N): `, (confirmContinue) => {
            // 输出用户是否继续的结果
            if (confirmContinue.toLowerCase() === 'y') {

                // 官方版本需要额外确认一次
                if (!isOfficial) {
                    resolve(true);
                    rl.close();
                    return;
                }
                // 确认用户是否继续
                rl.question('是否确认构建上传正式环境? (input Y or N): ', (confirmContinue) => {
                    // 关闭 readline 接口
                    // 输出用户是否继续的结果
                    if (confirmContinue.toLowerCase() === 'y') {
                        resolve(true);
                        return;
                    }
                    console.log('用户取消了操作, 正式服取消构建');
                    process.exit(1);
                });

            } else {
                console.log('用户取消了操作');
                process.exit(1);
            }
        });
    });
    if (!inputResult) { process.exit(1); }

    return { version, environment, isOfficial, cocosEditPath, test, retainSubPackages };
}

// 读取账号密码json配置
async function readPasswordConfigJson() {
    return await new Promise((resolve) => {
        fs.readFile('wechat_password.json', 'utf8', (err, data) => {
            if (err) {
                console.error('读取文件时出错:', err);
                process.exit(1);
            }
            // 将 JSON 字符串解析为 JavaScript 对象
            const config = JSON.parse(data);
            resolve(config);
        });
    });
}

// 读取构建json配置
async function readBuildConfigJson({ HttpRemoteServe, version }) {
    let outName = "";
    await new Promise((resolve) => {
        fs.readFile('wechat_buildConfig_auto.json', 'utf8', (err, data) => {
            if (err) {
                console.error('读取文件时出错:', err);
                process.exit(1);
            }

            try {
                // 将 JSON 字符串解析为 JavaScript 对象
                const config = JSON.parse(data);
                // 拿到构建出的名字
                outName = config.outputName;
                // 修改版本号和服务器地址
                config.server = `${HttpRemoteServe}${version}`;

                // 将 JavaScript 对象转换回 JSON 字符串
                const updatedData = JSON.stringify(config, null, 2);

                // 写入更新后的 JSON 文件
                fs.writeFile('wechat_buildConfig_auto.json', updatedData, 'utf8', (err) => {
                    if (err) {
                        console.error('写入文件时出错:', err);
                        process.exit(1);
                    }
                    console.log('文件已成功更新.');
                    resolve();
                });
            } catch (error) {
                console.error('解析 JSON 文件时出错:', error);
                process.exit(1);
            }
        });
    });
    return outName;
}

// 进行构建
async function buildProject({ outName, cocosEditPath, test }) {
    // --project：必填，指定项目路径
    // --engine：选填，指定自定义引擎路径
    // --build：指定构建项目使用的参数
    //     在--build 后如果没有指定参数，则会使用 Cocos Creator 中 构建发布 面板当前的平台、模板等设置来作为默认参数。如果指定了其他参数设置，则会使用指定的参数来覆盖默认参数。可选择的参数有：
    //     configPath - 参数文件路径。如果定义了这个字段，那么构建时将会按照 json 文件格式来加载这个数据，并作为构建参数。这个参数可以自己修改也可以直接从构建面板导出，当配置和 configPath 内的配置冲突时，configPath 指定的配置将会被覆盖。
    // 保存信息并运行
    // ...\CocosCreator.exe --project projectPath --engine path --build "platform=web-desktop;debug=true"
    console.warn("开始构建, 该过程耗时较长, 请勿关闭.(关闭后cocos仍然会执行构建, 但是不会上传)");
    let timer = setInterval(() => { buildTime += 5; console.warn(`构建中,当前耗时: ${buildTime}秒...`) }, 5 * 1000);
    const projectPath = path.join(__dirname, './../../'); // 项目相对路径
    const enginePath = path.join(__dirname, './../../engine'); // 自定义本地引擎相对路径
    const cocosCreatorPath = cocosEditPath;
    const engineStr = fs.existsSync(enginePath) ? `--engine ${enginePath} ` : "";
    const command =
        `${cocosCreatorPath} `
        + `--project ${projectPath} `
        + engineStr
        + `--build "configPath=wechat_buildConfig_auto.json"`
        ;
    let buildResult = await new Promise((resolve, reject) => {
        exec(command, async (error, stdout, stderr) => {
            if (error) {
                console.error(`执行命令时出错：${error}`);
            }
            console.log(`命令输出：${stdout}`);

            // 测试操作, 这里会有对文件的修改删除处理(正常情况下不会运行)
            await testOperate({ outName, test });

            clearInterval(timer);
            resolve(true);
        });
    });
    return buildResult;
}

// 压缩zip
async function zipDirectory(source, out) {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(out);

    return new Promise((resolve, reject) => {
        archive
            .directory(source, "remote")
            .on('error', reject)
            .pipe(stream);

        stream.on('close', () => resolve());
        archive.finalize();
    });
}















/// -------- 下方是没有使用到的方法, 如果不需要可以自行删除

// http请求
function sendHttpPostRequest(url, data) {
    return new Promise((resolve, reject) => {
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(url, options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                resolve(responseData);
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(JSON.stringify(data));
        req.end();
    });
}

// https请求
function sendHttpsPostRequest(url, data) {
    return new Promise((resolve, reject) => {
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(url, options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                resolve(responseData);
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(JSON.stringify(data));
        req.end();
    });
}

// 递归上传文件夹
function uploadDirectory(client, localPath, remotePath, callback) {
    fs.readdir(localPath, (err, files) => {
        if (err) {
            console.error('Error reading local directory:', err);
            callback(err);
            return;
        }

        let count = files.length;
        if (count === 0) {
            callback(null);
            return;
        }

        files.forEach((file) => {
            const filePath = path.join(localPath, file);
            const remoteFilePath = `${remotePath}/${file}`;

            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.error('Error getting file stats:', err);
                    callback(err);
                    return;
                }

                if (stats.isFile()) {
                    // 如果是文件，则上传
                    client.put(filePath, remoteFilePath, (err) => {
                        if (err) {
                            console.error('Error uploading file:', err);
                        } else {
                            console.log(`File uploaded: ${file}`);
                        }
                        count--;
                        if (count === 0) {
                            callback(null);
                        }
                    });
                } else if (stats.isDirectory()) {
                    // 如果是目录，则递归上传
                    client.mkdir(remoteFilePath, true, (err) => {
                        if (err) {
                            console.error('Error creating remote folder:', err);
                            callback(err);
                            return;
                        }
                        console.log(`Remote folder created: ${remoteFilePath}`);
                        uploadDirectory(client, filePath, remoteFilePath, () => {
                            count--;
                            if (count === 0) {
                                callback(null);
                            }
                        });
                    });
                }
            });
        });
    });
}

