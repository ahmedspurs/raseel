# Connect WhatsApp

Raseel talks to Meta's official **WhatsApp Cloud API** with your own Meta app. No middleman (BSP) is needed. You will copy four values from Meta into **Settings → WhatsApp**, then paste two values from Raseel back into Meta.

> [!NOTE]
> Meta bills your business directly for WhatsApp conversations. See [WhatsApp pricing](https://developers.facebook.com/docs/whatsapp/pricing).

## Before you start

- A [Meta Business portfolio](https://business.facebook.com/) for your business
- A phone number that is **not** registered in the WhatsApp or WhatsApp Business app (or migrate it to the Cloud API)
- Raseel running on a public HTTPS domain (Meta only delivers webhooks over HTTPS)

## 1. Create the Meta app

1. Go to [Meta for Developers](https://developers.facebook.com/apps) → **Create app**.
2. Choose the **Connect with customers through WhatsApp** use case and select your business portfolio.
3. In the app, open **WhatsApp → API Setup** and add your business phone number. Verify it with the code Meta sends.

## 2. Copy the IDs

On **WhatsApp → API Setup**, copy:

| Raseel field                     | Where to find it                           |
| -------------------------------- | ------------------------------------------ |
| **Phone Number ID**              | Under your phone number, "Phone number ID" |
| **WhatsApp Business Account ID** | "WhatsApp Business Account ID"             |

## 3. Create a permanent access token

The temporary token on the API Setup page expires within a day. Create a permanent one:

1. Open [Business Settings → System users](https://business.facebook.com/settings/system-users) and add a system user (Admin).
2. **Assign assets**: your app (Full control) and your WhatsApp account (Full control).
3. **Generate token** for your app with these permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. Copy the token. Meta only shows it once.

## 4. Copy the app secret

In the app, open **App settings → Basic** and click **Show** next to **App secret**. Raseel uses it to check that every webhook really comes from Meta.

## 5. Connect in Raseel

Open **Settings → WhatsApp**, paste the four values and click **Verify and connect**. Raseel checks them with Meta before saving. The token and app secret are stored encrypted and are never shown again in full.

## 6. Configure the webhook in Meta

1. In Raseel, copy the **Callback URL** (`https://your-domain/webhooks/whatsapp`) and the **Verify token** from the Webhook card.
2. In the Meta app, open **WhatsApp → Configuration → Webhook → Edit**, paste both values and click **Verify and save**.
3. Under **Webhook fields**, subscribe to **messages**.

Send a WhatsApp message to your business number. The Webhook card in Raseel turns green when the first event arrives, and the conversation appears in the inbox.

## Troubleshooting

| Problem                                 | Fix                                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Meta did not accept these credentials" | Check the Phone Number ID and WABA ID, and that the token has both permissions and the WhatsApp account is assigned to the system user.                                               |
| Meta cannot verify the callback URL     | The domain must serve valid HTTPS and reach Raseel. Check `https://your-domain/health` from outside the server.                                                                       |
| Messages do not arrive                  | Make sure **messages** is subscribed under Webhook fields, and check `docker compose logs api worker`. A `rejected webhook with invalid signature` log means the app secret is wrong. |
| Replies fail with "More than 24 hours…" | Customers must write first, and free-form replies are only allowed for 24 hours after their last message. Use an approved template outside that window.                               |

---

<div dir="rtl">

## ربط واتساب (ملخص بالعربي)

1. أنشئ تطبيقاً في [Meta for Developers](https://developers.facebook.com/apps) باختيار حالة الاستخدام الخاصة بواتساب، وأضف رقم نشاطك ووثّقه.
2. من صفحة **WhatsApp → API Setup** انسخ **معرّف رقم الهاتف** و**معرّف حساب واتساب للأعمال**.
3. من **إعدادات الأعمال ← مستخدمو النظام** أنشئ مستخدم نظام، واربطه بالتطبيق وحساب واتساب، ثم أنشئ **رمز وصول دائم** بالصلاحيتين `whatsapp_business_messaging` و `whatsapp_business_management`.
4. من **إعدادات التطبيق ← أساسي** انسخ **المفتاح السري للتطبيق**.
5. في رسيل افتح **الإعدادات ← واتساب**، الصق القيم الأربع واضغط **تحقّق واربط**.
6. انسخ **رابط الاستدعاء** و**رمز التحقق** من رسيل، والصقهما في تطبيق ميتا تحت **WhatsApp → Configuration → Webhook**، ثم اشترك في حقل **messages**.

أرسل رسالة واتساب لرقم نشاطك، وستظهر المحادثة في صندوق رسيل.

</div>
