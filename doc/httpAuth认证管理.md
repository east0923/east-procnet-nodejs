http请求身份认证类说明
---
## 作用
在不同的站点类(c_site)内，可使用httpAuth实例对node原生request对象进行身份认证，向request对象添加属性httpAuth。

## 认证方案
### 1、SessionId

存储在Cookie中，HttpOnly类型，即禁止前端JavaScript脚本访问。

所有涉及SessionId的请求，均应该以Https方式访问。

### 2、Token

* Token：可作为登录凭证，换取SessionId，也可以直接认证AccountId

## 认证信息云端存储

所有认证信息均存储于Redis数据库，所有键都需要有前缀prefix。

### 0、认证管理信息
**key结构：[prefix]info**

有效期：永久有效

字典项目：

| 键 | 说明 | 类别 | 备注 |
| --- | --- | --- | --- |
| confJson | 配置信息 | Json字符串 | 必须有 |

### 1、Session信息
**key结构：[prefix]se_[SessionId]**

有效期：根据配置设定，默认20分钟

字典项目：


| 键 | 说明 | 类别 | 备注 |
| --- | --- | --- | --- |
| BuildSt | 创建时间戳 | Int字符串 | 必须有 |
| AccountId | 关联账号Id | 字符串 | 可能为空，表示未登录 |
| Security | 安全认证等级| Int字符串 | 空等效于0 | 

### 2、Token存储
**key结构：[prefix]to_[Token]**

有效期：发放或更新Token时，自行判定

字典项目：

| 键 | 说明 | 类别 | 备注 |
| --- | --- | --- | --- |
| BuildSt | 创建时间戳 | Int字符串 | 必须有 |
| AccountId | 关联账号Id | 字符串 | 必须有 |