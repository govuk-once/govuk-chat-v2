import boto3
from boto3.dynamodb.conditions import Key
from datetime import datetime, timezone
import uuid
from pprint import pp

def make_message_sk() -> str:
    """
    Create a DynamoDB sort key for a message.

    The key uses the form ``MSG#<timestamp>#<uuid>`` so that:

    - the ``MSG#`` prefix identifies the item type,
    - the UTC ISO 8601 timestamp sorts correctly as a string in time order,
    - and the UUID prevents collisions when multiple messages are created at
      nearly the same instant.

    UTC is used to avoid timezone ambiguity, microseconds are included for
    consistent precision, and ``Z`` is used as the standard UTC suffix.
    """
    ts = datetime.now(timezone.utc).isoformat(timespec="microseconds")
    ts = ts.replace("+00:00", "Z")
    return f"MSG#{ts}#{uuid.uuid4().hex}"

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table('chaecramb-govuk-chat-chat-api-table')


print('Clear existing items in the table')
with table.batch_writer() as batch:
    resp = table.query(
        KeyConditionExpression=Key('PK').eq('CONVERSATION#123')
    )

    for item in resp.get("Items", []):
        batch.delete_item(
            Key={
                'PK': item['PK'],
                'SK': item['SK'],
            }
        )

conversation_items = table.query(
    KeyConditionExpression=Key('PK').eq('CONVERSATION#123')
    )
print(f'Conversation items: {conversation_items['Count']}')

print('Add items to the table')
table.put_item(
    Item={
        'PK': 'CONVERSATION#123',
        'SK': 'METADATA',
        'title': 'Test',
    }
)

table.put_item(
    Item={
        'PK': 'CONVERSATION#123',
        'SK': make_message_sk(),
        'role': 'ASSISTANT',
        'entityType': 'MESSAGE',
        'content': 'Hi! How can I help you?',
    }
)

table.put_item(
    Item={
        'PK': 'CONVERSATION#123',
        'SK': make_message_sk(),
        'role': 'USER',
        'entityType': 'MESSAGE',
        'content': 'How much tax should I pay?',
    }
)

# Get an items from the table
metadata = table.get_item(
    Key={
        'PK': 'CONVERSATION#123',
        'SK': 'METADATA'
    }
)

print(f'Conversation title: {metadata['Item']['title']}')

# Query the table by primary key
conversation_items = table.query(
    KeyConditionExpression=Key('PK').eq('CONVERSATION#123')
    )

for item in conversation_items['Items']:
    if item.get('entityType') == 'MESSAGE':
        print(f'{item['role']}: {item['content']}')

# Update an item
response = table.update_item(
    Key={
        'PK': 'CONVERSATION#123',
        'SK': 'METADATA'
    },
    UpdateExpression='SET title = :title',
    ExpressionAttributeValues={
        ':title': 'First Conversation'
    },
    ReturnValues='ALL_NEW'
)

print(response['Attributes'])
