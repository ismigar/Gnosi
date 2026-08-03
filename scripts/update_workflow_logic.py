import requests
import json
import copy

API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0OWY3MjNjMi1hOGYzLTRiM2EtYTBjMC03MzM4NzRiNDk0YjEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzY2MjcwOTcyfQ.RxQihFjk7d-CrvgEAWOeR96DibxVOda72Qp3bnv-oJ4"
BASE_URL = "http://localhost:5678/api/v1"
HEADERS = {"X-N8N-API-KEY": API_KEY}
WF_ID = "P7PTDH3uqldJn62X"

def main():
    print(f"Fetching workflow {WF_ID}...")
    try:
        r = requests.get(f"{BASE_URL}/workflows/{WF_ID}", headers=HEADERS)
        r.raise_for_status()
        wf = r.json()
    except Exception as e:
        print(f"Error fetching workflow: {e}")
        return

    nodes = wf.get("nodes", [])
    connections = wf.get("connections", {})
    
    print("Modifying workflow structure...")
    
    # 1. SHIFT NODES to make space
    # Target area is after "Merge Image+Content" (Position x approx 3712)
    start_shift_x = 3800
    shift_amount = 1200
    
    for node in nodes:
        if node["position"][0] > start_shift_x:
            node["position"][0] += shift_amount

    # 2. DEFINE NEW NODES
    
    # Node: CheckFile (Code)
    check_file_node = {
        "parameters": {
            "jsCode": """const item = $input.item.json;
const props = item.properties || {};
let fileUrl = null;
let fileName = null;

// Check 'Fitxer' or 'Adjunt'
let fileProp = props['Fitxer'] || props['Adjunt'];

if (fileProp && fileProp.files && fileProp.files.length > 0) {
    const fileObj = fileProp.files[0];
    fileUrl = fileObj.file ? fileObj.file.url : fileObj.external.url;
    // Sanitize filename: remove non-alphanumeric except dots, dashes, underscores
    fileName = fileObj.name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

if (fileUrl) {
    return {
        json: {
            ...item,
            has_file: true,
            file_url: fileUrl,
            file_name: fileName
        }
    };
} else {
    return {
        json: {
            ...item,
            has_file: false
        }
    };
}"""
        },
        "id": "CheckFile",
        "name": "CheckFile",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [3800, 368]
    }

    # Node: If has file (Switch/If)
    if_file_node = {
        "parameters": {
            "conditions": {
                "options": {
                    "caseSensitive": True,
                    "leftValue": "",
                    "typeValidation": "strict",
                    "version": 2
                },
                "conditions": [
                    {
                        "id": "cond_has_file",
                        "leftValue": "={{ $json.has_file }}",
                        "rightValue": "",
                        "operator": {
                            "type": "boolean",
                            "operation": "true",
                            "singleValue": True
                        }
                    }
                ],
                "combinator": "and"
            }
        },
        "id": "IfFile",
        "name": "If has file",
        "type": "n8n-nodes-base.if",
        "typeVersion": 2.2,
        "position": [4000, 368]
    }

    # Node: DownloadFile (HTTP)
    download_file_node = {
        "parameters": {
            "url": "={{ $json.file_url }}",
            "options": {
                "response": {
                    "response": {
                        "responseFormat": "file"
                    }
                }
            }
        },
        "id": "DownloadFile",
        "name": "DownloadFile",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.1,
        "position": [4200, 250],
        "retryOnFail": True
    }

    # Node: UploadFileDrupal_Fitxer (HTTP)
    upload_file_node = {
        "parameters": {
            "method": "POST",
            "url": "https://www.temenosismael.org/jsonapi/media/document/field_media_document",
            "authentication": "genericCredentialType",
            "genericAuthType": "httpBasicAuth",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {
                        "name": "Content-Type",
                        "value": "application/octet-stream"
                    },
                    {
                        "name": "Content-Disposition",
                        "value": '=file; filename="{{ $json.file_name }}"'
                    },
                    {
                        "name": "Accept",
                        "value": "application/vnd.api+json"
                    }
                ]
            },
            "sendBody": True,
            "contentType": "binaryData",
            "inputDataFieldName": "data",
             "options": {
                "response": {
                    "response": {
                        "responseFormat": "json"
                    }
                }
            }
        },
        "id": "UploadFileDrupal_Fitxer",
        "name": "UploadFileDrupal_Fitxer",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.1,
        "position": [4400, 250],
        "credentials": {
            "httpBasicAuth": {
                "id": "kOEOYuMRLNjJVoPG",
                "name": "TemenosIsmael admin"
            }
        }
    }

    # Node: SetFileUUID (Set)
    set_file_uuid_node = {
        "parameters": {
            "assignments": {
                "assignments": [
                    {
                        "name": "drupal_attachment_uuid",
                        "value": "={{ $json.data.id }}",
                        "type": "string"
                    }
                ]
            },
            "options": {}
        },
        "id": "SetFileUUID",
        "name": "SetFileUUID",
        "type": "n8n-nodes-base.set",
        "typeVersion": 3.4,
        "position": [4600, 250]
    }

    # Node: Merge File Results (Merge)
    merge_file_node = {
        "parameters": {
            "mode": "combine",
            "combineBy": "combineByPosition",
             "options": {
                "includeUnpaired": True
            }
        },
        "id": "MergeFileResults",
        "name": "MergeFileResults",
        "type": "n8n-nodes-base.merge",
        "typeVersion": 3.2,
        "position": [4800, 368]
    }

    # Add new nodes to list
    new_nodes = [check_file_node, if_file_node, download_file_node, upload_file_node, set_file_uuid_node, merge_file_node]
    nodes.extend(new_nodes)

    # 3. UPDATE PREPARER CODE (DrupalPayloadPreparer)
    preparer_code = """const item = $input.item.json;
const notionId = item.id.replace(/-/g, '');
let drupalType = "article";
let payload = {};
// Defines the endpoint.
const baseUrl = "https://www.temenosismael.org";
let endpoint = `${baseUrl}/jsonapi/node/article`;

const props = item.properties || {};

// Title Logic
let title = "Untitled";
// Try to find title
if (props['Title'] && props['Title'].title && props['Title'].title.length > 0) {
    title = props['Title'].title[0].plain_text;
} else if (props['Nom'] && props['Nom'].title && props['Nom'].title.length > 0) {
    title = props['Nom'].title[0].plain_text;
} else if (props['Títol'] && props['Títol'].title && props['Títol'].title.length > 0) {
    title = props['Títol'].title[0].plain_text;
} else {
    // Fallback scan
    for (const key of Object.keys(props)) {
        if (props[key].type === 'title' && props[key].title.length > 0) {
            title = props[key].title[0].plain_text;
            break;
        }
    }
}

// Extract 'Any' (Year) - Support 'Any' or 'Year' number property
let anyValue = null;
if (props['Any']) anyValue = props['Any'].number;
else if (props['Year']) anyValue = props['Year'].number;


// Relationships (Tags and Media)
const relationships = {};

// Tags
if (item.drupal_tag_ids && item.drupal_tag_ids.length > 0) {
    relationships.field_tags = {
        data: item.drupal_tag_ids.map(id => ({ type: "taxonomy_term--tags", id: id }))
    };
}

// Image (Media Entity)
if (item.drupal_media_uuid) {
    relationships.field_image = {
        data: { type: item.drupal_media_type || "file--file", id: item.drupal_media_uuid }
    };
}

// File Attachment (Adjunt -> field_fitxer)
if (item.drupal_attachment_uuid) {
    relationships.field_fitxer = {
        data: { type: "file--file", id: item.drupal_attachment_uuid }
    };
}

// Determine Type & Attributes based on properties (heuristic from final_mapping.json)
if (props['Materials']) {
    drupalType = "disseny";
    endpoint = `${baseUrl}/jsonapi/node/disseny`;

    const materials = props['Materials'].rich_text ? props['Materials'].rich_text.map(t => t.plain_text).join('') : "";

    payload = {
        data: {
            type: "node--disseny",
            attributes: {
                title: title,
                field_materials: materials,
                body: {
                    value: item.html_body || "",
                    format: "full_html"
                }
            },
            relationships
        }
    };
    if (anyValue) payload.data.attributes.field_any = anyValue;
    
} else if (props['Logo']) {
    drupalType = "col_laboradora";
    endpoint = `${baseUrl}/jsonapi/node/col_laboradora`;

    payload = {
        data: {
            type: "node--col_laboradora",
            attributes: {
                title: title,
                body: {
                    value: item.html_body || "",
                    format: "full_html"
                }
            },
            relationships
        }
    };
    // Check if col_laboradora has field_any? Usually not, but if so add here.
    
} else if (props['Llibre/Revista']) {
    drupalType = "recurs";
    endpoint = `${baseUrl}/jsonapi/node/recurs`;

    const llibre = props['Llibre/Revista'].rich_text ? props['Llibre/Revista'].rich_text.map(t => t.plain_text).join('') : "";

    payload = {
        data: {
            type: "node--recurs",
            attributes: {
                title: title,
                field_llibre_revista: llibre,
                body: {
                    value: item.html_body || "",
                    format: "full_html"
                }
            },
            relationships
        }
    };
    
    if (anyValue) payload.data.attributes.field_any = anyValue;

} else {
    // Default to Article
    drupalType = "article";
    endpoint = `${baseUrl}/jsonapi/node/article`;

    // For Article, we use html_body generated by notionBlocksToHtml.js
    const bodyValue = item.html_body || "";

    payload = {
        data: {
            type: "node--article",
            attributes: {
                title: title,
                body: {
                    value: bodyValue,
                    format: "full_html"
                }
            },
            relationships
        }
    };
    if (anyValue) payload.data.attributes.field_any = anyValue;
}

return {
    json: {
        ...item,
        drupal_endpoint: endpoint,
        drupal_payload: payload,
        calculated_drupal_type: drupalType
    }
};
"""
    
    # Update Preparer node
    for node in nodes:
        if node["name"] == "DrupalPayloadPreparer":
            node["parameters"]["jsCode"] = preparer_code
            print("Updated DrupalPayloadPreparer code.")


    # 4. UPDATE CONNECTIONS
    # We need to insert our chain: Merge Image+Content -> CheckFile -> ... -> MergeFileResults -> DrupalPayloadPreparer
    
    # Previously: Merge Image+Content -> DrupalPayloadPreparer
    # Find connections FROM "Merge Image+Content"
    if "Merge Image+Content" in connections:
        # Move these connections to "CheckFile"
        connections["CheckFile"] = connections.pop("Merge Image+Content")
        # BUT wait, the keys in 'connections' are Source Nodes.
        # "Merge Image+Content" connects TO "DrupalPayloadPreparer".
        # So "Merge Image+Content": { "main": [[ { "node": "DrupalPayloadPreparer" } ]] }
        
        # We want: "Merge Image+Content": { "main": [[ { "node": "CheckFile" } ]] }
        connections["Merge Image+Content"] = {
            "main": [
                [
                    {
                        "node": "CheckFile",
                        "type": "main",
                        "index": 0
                    }
                ]
            ]
        }
    
    # Now define connections for our new nodes
    
    # CheckFile -> If has file
    connections["CheckFile"] = {
        "main": [
            [
                {
                    "node": "If has file",
                    "type": "main",
                    "index": 0
                }
            ]
        ]
    }
    
    # If has file (True) -> DownloadFile
    connections["If has file"] = {
        "main": [
            [
                {
                    "node": "DownloadFile",
                    "type": "main",
                    "index": 0
                }
            ],
            # If has file (False) -> MergeFileResults (Input 2 - index 1)
             [
                {
                    "node": "MergeFileResults",
                    "type": "main",
                    "index": 1
                }
            ]
        ]
    }
    
    # DownloadFile -> UploadFileDrupal_Fitxer
    connections["DownloadFile"] = {
        "main": [
            [
                {
                    "node": "UploadFileDrupal_Fitxer",
                    "type": "main",
                    "index": 0
                }
            ]
        ]
    }
    
    # UploadFileDrupal_Fitxer -> SetFileUUID
    connections["UploadFileDrupal_Fitxer"] = {
        "main": [
            [
                {
                    "node": "SetFileUUID",
                    "type": "main",
                    "index": 0
                }
            ]
        ]
    }
    
    # SetFileUUID -> MergeFileResults (Input 1 - index 0)
    connections["SetFileUUID"] = {
        "main": [
            [
                {
                    "node": "MergeFileResults",
                    "type": "main",
                    "index": 0
                }
            ]
        ]
    }
    
    # MergeFileResults -> DrupalPayloadPreparer
    connections["MergeFileResults"] = {
        "main": [
            [
                {
                    "node": "DrupalPayloadPreparer",
                    "type": "main",
                    "index": 0
                }
            ]
        ]
    }

    # IMPORTANT: Ensure DrupalPayloadPreparer is NOT connected from old source effectively.
    # We handled "Merge Image+Content" logic above.
    
    
    # 5. PREPARE & SEND UPDATE
    # Remove "active" field to avoid errors as it is read-only
    payload = {
        "nodes": nodes,
        "connections": connections,
        "settings": wf.get("settings", {}),
        "staticData": wf.get("staticData", None),
        "name": wf.get("name"),
    }
    
    print("Sending update to n8n...")
    try:
        res = requests.put(f"{BASE_URL}/workflows/{WF_ID}", headers=HEADERS, json=payload)
        if res.status_code != 200:
            print(f"Failed to update workflow: {res.text}")
        else:
            print("Success! Workflow structure updated.")
    except Exception as e:
        print(f"Error updating workflow: {e}")

if __name__ == "__main__":
    main()
