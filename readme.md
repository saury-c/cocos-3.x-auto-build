### 配置 FTP 服务器密码
- 复制同目录下的 wechat_password_template.json
- 修改文件内容: host, port, user, password. 
    - 分别对应 ip, 端口, 用户名, 密码
- 修改命名为 wechat_password.json

---

### 确保本地依赖包正确安装
- 在同目录下, 打开 cmd 命令行, 运行 npm i, 安装依赖包
    - 如果 npm i 报错, 则需要自行去官网安装 NodeJs

---

### 配置 Cocos Creator 引擎路径
- 获取到游戏引擎运行路径. 
    -  例如 D:\\\cocos\\\editors\\\Creator\\\3.8.2\\\CocosCreator.exe
- 新增运行命令.
    - 打开 package.json 
    - 在 scripts 内复制新增内容
    - 举例新增内容  "wechat_build_selfxxx": "node wechat_build.js  --cocosEditPath=D:\\\cocos\\\editors\\\Creator\\\3.8.2\\\CocosCreator.exe"
    
---

### 运行命令行构建上传
- 运行的参数
    - environment 发布的环境, 目前类型 ( pretest 预发布, official 正式版 )
    - version 上传至 FTP 服务器的文件夹名称 ( 尽量避免重复使用 ). 格式 xxx.xxx.xxx, 例如 1.999.0
    - retainSubPackages 是否保留 remote 文件夹 和 remote.zip, 不填该值, 则会在完成上传后默认删除掉
- 常规运行 - cmd 版本
    - 在同目录下, 打开 cmd 命令行. 执行 npm run wechat_build environment=pretest version=1.0.0
        - 运行的内容在 package.json -> scripts 可以查看
    - 注意: 如果新增了运行命令配置, 运行的名称则需要修改成自己新增的名字
        - 例如上方新增了 wechat_build_selfxxx, 运行的命令就是 npm run wechat_build_selfxxx environment=pretest version=1.0.0
- 快捷运行 - bat 版本
    - 双击运行 wechat_run.bat, 按要求输入 environment 和 version 运行脚本
        - 该脚本内部有 cocos 存放项目路径, 请修改正确路径, 再运行
        - 有其他输入需求, 请自行拓展
- 特殊运行 - cmd 版本
    - 目前用于测试专门内容, 删除非必要上传的子包. 后续有需求可以自行添加 
        - ( 查看 pakage.json 内的 wechat_build_for_test 参数, 自行添加, 在代码内新增函数处理(改动很大的话建议新建脚本) )
    - 输入运行 npm run wechat_build_for_test environment=pretest version=1.0.0
        - 存在参数 --test=testDelete, 会删除 remote 内的部分文件夹, 减少上传构建量
            - 应用场景: 测试大厅, 不需要游戏内的 bundle, 也不会打开, 所以直接删除上传, 方便测试大厅

---

*FTP存放文件路径: xxx/xxx2/remotePackages/${version}*