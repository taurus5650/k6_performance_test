import {Counter, Rate} from 'k6/metrics';
import {URL} from 'https://jslib.k6.io/url/1.0.0/index.js';
import http from 'k6/http';
import {check} from 'k6';
import {hmac, sha256} from 'k6/crypto';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';
import {SharedArray} from 'k6/data';
import {htmlReport} from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";


const TEST_ENV_BASE_URL = 'https://test-env.com/';
const BUYER_GET_TOKEN_URL = 'BuyerGetToken';
const FINAL_BUYER_GET_TOKEN_URL = new URL(BUYER_GET_TOKEN_URL, TEST_ENV_BASE_URL);

const CREATE_TRANSACTION_URL = 'BuyerCreateTransaction';
const FINAL_CREATE_TRANSACTION_URL = new URL(CREATE_TRANSACTION_URL, TEST_ENV_BASE_URL);

const rateGetToken = new Rate('GetTokenRate');
const counterGetToken = new Counter('GetTokenCounter');
const rateCreateTransaction = new Rate('CreateTransactionRate');
const counterCreateTransaction = new Counter('CreateTransactionCounter');
const internalErrorCounter = new Counter('server_errors_999');

// Load Test Scenario
const Scenarios = {
    Case: {
        executor: 'constant-arrival-rate',
        rate: 50,
        timeUnit: '1s',
        duration: '5s',
        preAllocatedVUs: 5,
        maxVUs: 5,
        exec: 'CreateTransactionFunc',
    }
}

export const options = {
    scenarios: Scenarios,
    //noVUConnectionReuse: true,
    noConnectionReuse: false,
    thresholds: {
        http_req_failed: ["rate < 0.05"], 
        http_req_duration: ["avg < 1000", "p(95) < 1500"], 
    },
};

const userCsv = new SharedArray("JSFUser", function () {
    const data = papaparse.parse(open('../../testdata/feature1/user.csv'), {header: true}).data;
    return data;
});
const storeCsv = new SharedArray("JSFStore", function () {
    const data = papaparse.parse(open('../../testdata/feature1/store.csv'), {header: true}).data;
    return data;
});

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
        .replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0,
                v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
}


function buyerGetToken(userPhone, accountId, userId, platformUID, correlationId) {

    const GetTokenBody = JSON.stringify({
        Phone: userPhone,
        AccountId: accountId,
        UserId: userId,
        PlatformUID: platformUID,
    });

    const GetTokenHeaders = {
        'Content-Type': 'application/json',
        'X-Correlation-Id': correlationId,
    };
    const res = http.post(FINAL_BUYER_GET_TOKEN_URL.toString(), GetTokenBody, {headers: GetTokenHeaders});

    const checkIsStatus200 = check(res, {'GetToken res.status is 200': (r) => r.status === 200});
    const checkIsResultSuccess = check(res, {'GetToken res.body': (r) => r.json()['Result'] === 1,});

    if (checkIsStatus200 && checkIsResultSuccess) {
        rateGetToken.add(1);
        counterGetToken.add(1)
    }

    const userAccountKey = res.json()['ResultObject']['Key'];
    return {userAccountKey};
}


export function CreateTransactionFunc() {

    console.log(`--- ---- ---- START --- ---- ----`);
    
    const randomUserIndex = Math.floor(Math.random() * userCsv.length);
    const randomUser = userCsv[randomUserIndex];
    const randomStoreIndex = Math.floor(Math.random() * storeCsv.length);
    const randomStore = storeCsv[randomStoreIndex];


    const correlationId = uuidv4();
    const userPhone = randomUser.Phone;
    const userId = randomUser.UserId;
    const platformUID = randomUser.PlatformUID;
    const userAccountId = randomUser.AccountId;
    const {userAccountKey} = buyerGetToken(userPhone, accountId, userId, platformUID, correlationId)
    
    const storeId = randomStore.StoreId;

    const randomPlatformOrderId = `K6_${Date.now()}_${correlationId}`;
    // console.log(`✶ ✶ ✶ K6Order: ${randomPlatformOrderId}`)

    const createTransactionBody = JSON.stringify({
        account_id: userAccountId,
        account_key: userAccountKey,
        order: {
            platform_order_id: randomPlatformOrderId,
            store_id: storeId,
            currency: 'TWD',
            total_price: 1,
        }
    });
    
    const createTransactionHeaders = {
        'Content-Type': 'application/json',
        'X-Correlation-Id': correlationId,
    };

    const res = http.post(FINAL_CREATE_TRANSACTION_URL.toString(), createTransactionBody, {headers: createTransactionHeaders});

    const checkIsStatus200 = check(res, {'CreateTransaction res.status is 200': (r) => r.status === 200});
    const checkIsResultSuccess = check(res, {'CreateTransaction res.body': (r) => r.json()['result'] === '000'});
    if (checkIsStatus200 && checkIsResultSuccess) {
        rateCreateTransaction.add(1);
        counterCreateTransaction.add(1)
    }

    const isResultServerErr = res.json()['result'] === '999'
    if (isResultServerErr) {
        console.error('Server Error !!!!!');
        internalErrorCounter.add(1);
    }

}

export function handleSummary(data) {
    return {
        "summary.html": htmlReport(data),
    };
}

