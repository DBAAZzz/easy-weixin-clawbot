#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AKShare Stock Analysis CLI Tool
专业股票分析工具：行情查询、技术指标、持仓诊断、热点板块
数据源：腾讯财经API + 东方财富K线
"""
import akshare as ak
import json
import argparse
import sys
import warnings
import requests

warnings.filterwarnings('ignore')
sys.stdout.reconfigure(encoding='utf-8')

# API配置
TENCENT_URL = "https://qt.gtimg.cn/q="
HEADERS = {'User-Agent': 'Mozilla/5.0'}

def get_index_tencent():
    """从腾讯API获取大盘指数"""
    try:
        r = requests.get(TENCENT_URL + 'sh000001,sz399001,sz399006', headers=HEADERS, timeout=10)
        r.encoding = 'gbk'
        result = {}
        names = {'sh000001': '上证指数', 'sz399001': '深证成指', 'sz399006': '创业板指'}
        
        lines = r.text.strip().split('\n')
        for line in lines:
            if '="' in line:
                code_part = line.split('="')[0].replace('v_', '')
                data = line.split('"')[1].split('~')
                if code_part in names and len(data) > 32:
                    result[names[code_part]] = {
                        '最新价': float(data[3]),
                        '涨跌额': float(data[31]),
                        '涨跌幅': float(data[32])
                    }
        return result
    except Exception as e:
        return {"error": str(e), "code": "FAILED"}

def get_stock_spot(code=None):
    """获取股票实时行情"""
    try:
        if not code:
            return get_index_tencent()
        
        if code.startswith('6'):
            t_code = f"sh{code}"
        elif code.startswith(('0', '3')):
            t_code = f"sz{code}"
        else:
            t_code = code
        
        r = requests.get(TENCENT_URL + t_code, headers=HEADERS, timeout=10)
        r.encoding = 'gbk'
        
        if '="' in r.text:
            data = r.text.split('"')[1].split('~')
            if len(data) > 32:
                return [{
                    '代码': code,
                    '名称': data[1],
                    '最新价': float(data[3]),
                    '涨跌额': float(data[31]),
                    '涨跌幅': float(data[32])
                }]
        return {"error": "未找到数据", "code": "NOT_FOUND"}
    except Exception as e:
        return {"error": str(e), "code": "FAILED"}

def get_hot_plates():
    """获取热点板块 - 从代表性股票近期表现"""
    try:
        codes = ['600519', '000858', '300750', '601318', '600036', '000001', '300059', '688981', '002475', '600276']
        hot_stocks = []
        
        for code in codes:
            try:
                df = ak.stock_zh_a_hist(symbol=code, period='daily', 
                                       start_date='20260301', end_date='20260403', adjust='qfq')
                if not df.empty:
                    latest = df.iloc[-1]
                    prev = df.iloc[-2] if len(df) > 1 else latest
                    hot_stocks.append({
                        '代码': code,
                        '最新价': float(latest['收盘']),
                        '今日涨跌': float(latest.get('涨跌幅', 0)),
                        '近5日涨跌': round((float(latest['收盘']) - float(prev['收盘'])) / float(prev['收盘']) * 100, 2) if len(df) > 1 else 0
                    })
            except:
                continue
        
        hot_stocks.sort(key=lambda x: x['今日涨跌'], reverse=True)
        return {'今日热点代表股': hot_stocks[:10], '说明': '代表性蓝筹股表现', '数据源': '东方财富'}
    except Exception as e:
        return {"error": str(e), "code": "FAILED"}

def calculate_tech_indicators(code, start_date, end_date, period='daily'):
    """计算技术指标"""
    try:
        period_map = {'daily': 'daily', 'weekly': 'weekly', 'monthly': 'monthly'}
        df = ak.stock_zh_a_hist(
            symbol=code, 
            period=period_map.get(period, 'daily'), 
            start_date=start_date, 
            end_date=end_date, 
            adjust='qfq'
        )
        
        df['MA5'] = df['收盘'].rolling(window=5).mean()
        df['MA10'] = df['收盘'].rolling(window=10).mean()
        df['MA20'] = df['收盘'].rolling(window=20).mean()
        
        ema_fast = df['收盘'].ewm(span=12, adjust=False).mean()
        ema_slow = df['收盘'].ewm(span=26, adjust=False).mean()
        df['DIF'] = ema_fast - ema_slow
        df['DEA'] = df['DIF'].ewm(span=9, adjust=False).mean()
        df['MACD'] = 2 * (df['DIF'] - df['DEA'])
        
        delta = df['收盘'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['RSI'] = 100 - (100 / (1 + rs))
        
        result_cols = ['日期', '收盘', 'MA5', 'MA10', 'MA20', 'DIF', 'DEA', 'MACD', 'RSI']
        available_cols = [c for c in result_cols if c in df.columns]
        return df[available_cols].tail(30).to_dict('records')
    except Exception as e:
        return {"error": str(e), "code": "FAILED"}

def diagnose_holdings(holdings_json):
    """持仓诊断"""
    try:
        holdings = json.loads(holdings_json)
    except:
        return {"error": "Invalid JSON format", "code": "INVALID_INPUT"}
    
    diagnosis = []
    
    for h in holdings:
        code = h.get('code', '')
        try:
            if code.startswith('6'):
                t_code = f"sh{code}"
            else:
                t_code = f"sz{code}"
            
            r = requests.get(TENCENT_URL + t_code, headers=HEADERS, timeout=10)
            r.encoding = 'gbk'
            
            if '="' in r.text:
                data = r.text.split('"')[1].split('~')
                if len(data) > 3:
                    price = float(data[3])
                    cost = float(h.get('cost', 0))
                    shares = int(h.get('shares', 0))
                    profit = (price - cost) * shares
                    profit_rate = (price - cost) / cost * 100 if cost > 0 else 0
                    
                    diagnosis.append({
                        '代码': code,
                        '名称': h.get('name', data[1]),
                        '成本': cost,
                        '现价': price,
                        '盈亏': round(profit, 2),
                        '盈亏率(%)': round(profit_rate, 2),
                        '风险等级': '高' if abs(profit_rate) > 10 else '中' if abs(profit_rate) > 5 else '低'
                    })
        except:
            pass
    
    return {
        '总盈亏': round(sum([d['盈亏'] for d in diagnosis]), 2),
        '持仓数': len(diagnosis),
        '明细': diagnosis,
        '数据源': '腾讯财经'
    }

def get_summary():
    """财经数据汇总"""
    return {'大盘指数': get_index_tencent(), '备注': '数据来自腾讯财经'}

def main():
    parser = argparse.ArgumentParser(description='股票分析CLI工具')
    subparsers = parser.add_subparsers(dest='command')
    
    subparsers.add_parser('spot', help='获取股票实时行情').add_argument('--code', help='股票代码')
    
    tech = subparsers.add_parser('tech', help='计算技术指标')
    tech.add_argument('--code', required=True)
    tech.add_argument('--start', required=True)
    tech.add_argument('--end', required=True)
    tech.add_argument('--period', default='daily', choices=['daily', 'weekly', 'monthly'])
    
    subparsers.add_parser('diagnose', help='持仓诊断').add_argument('--holdings', required=True)
    subparsers.add_parser('plates', help='获取热点板块')
    subparsers.add_parser('summary', help='财经汇总')
    
    kline = subparsers.add_parser('kline', help='K线数据')
    kline.add_argument('--code', required=True)
    kline.add_argument('--start', required=True)
    kline.add_argument('--end', required=True)
    kline.add_argument('--period', default='daily')
    
    args = parser.parse_args()
    
    result = None
    if args.command == 'spot':
        result = get_stock_spot(args.code)
    elif args.command == 'tech':
        result = calculate_tech_indicators(args.code, args.start, args.end, args.period)
    elif args.command == 'diagnose':
        result = diagnose_holdings(args.holdings)
    elif args.command == 'plates':
        result = get_hot_plates()
    elif args.command == 'summary':
        result = get_summary()
    elif args.command == 'kline':
        result = calculate_tech_indicators(args.code, args.start, args.end, args.period)
    else:
        parser.print_help()
        return
    
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
