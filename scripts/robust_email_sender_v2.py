import smtplib
import os
import sys
import argparse
from email.message import EmailMessage

def send_email(smtp_server, smtp_port, username, password, recipient, subject, body, attachment_path=None):
    try:
        msg = EmailMessage()
        msg['Subject'] = subject
        msg['From'] = username
        msg['To'] = recipient
        msg.set_content(body)

        if attachment_path and os.path.isfile(attachment_path):
            with open(attachment_path, 'rb') as f:
                file_data = f.read()
                file_name = os.path.basename(attachment_path)
                
            msg.add_attachment(
                file_data,
                maintype='application',
                subtype='octet-stream',
                filename=file_name
            )
            print(f"Attached: {file_name}")

        print(f"Connecting to {smtp_server}:{smtp_port}...")
        with smtplib.SMTP_SSL(smtp_server, smtp_port) as server:
            server.login(username, password)
            server.send_message(msg)
        print("✅ Email sent successfully!")
        return True

    except Exception as e:
        print(f"❌ Failed to send email: {e}")
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Robust Python Email Sender")
    parser.add_argument("--server", required=True, help="SMTP server (e.g., smtp.gmail.com)")
    parser.add_argument("--port", type=int, default=465, help="SMTP port (default 465)")
    parser.add_argument("--user", required=True, help="Your email address")
    parser.add_argument("--password", required=True, help="Your App Password")
    parser.add_argument("--to", required=
True, help="Recipient email")
    parser.add_argument("--subject", required=True, help="Email subject")
    parser.add_argument("--body", required=True, help="Email body")
    parser.add_argument("--attachment", help="Path to attachment")

    args = parser.parse_args()

    success = send_email(
        args.server, args.port, args.user, args.password, 
        args.to, args.subject, args.body, args.attachment
    )
    sys.exit(0 if success else 1)
