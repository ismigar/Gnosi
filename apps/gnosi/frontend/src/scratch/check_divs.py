
import sys

def count_divs(filepath):
    with open(filepath, 'r') as f:
        lines = f.readlines()
    
    stack = []
    return_started = False
    return_line = -1
    
    for i, line in enumerate(lines):
        line_num = i + 1
        if 'return (' in line:
            return_started = True
            return_line = line_num
            continue
        
        if not return_started:
            continue
            
        # Very simple tag matching
        # Find <div and </div
        import re
        opens = re.findall(r'<div\b', line)
        closes = re.findall(r'</div\b', line)
        
        for _ in opens:
            stack.append(line_num)
        for _ in closes:
            if stack:
                stack.pop()
            else:
                print(f"Extra closing div at line {line_num}")
                
        if line.strip() == ');' or line.strip() == ')':
            print(f"Return ended at line {line_num}. Stack size: {len(stack)}")
            if stack:
                print(f"Unclosed divs from lines: {stack}")
            break

if __name__ == "__main__":
    count_divs(sys.argv[1])
