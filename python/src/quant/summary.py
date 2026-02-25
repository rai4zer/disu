import pandas as pd
import argparse
from rich.console import Console
from rich.table import Table

console = Console()

def display_comprehensive_matrix(file_path):
    df = pd.read_parquet(file_path)
    
    # Create the Return Matrix (Magnitude)
    ret_matrix = df.pivot(index='ticker', columns='horizon', values='pred_return')
    # Create the Probability Matrix (Confidence)
    prob_matrix = df.pivot(index='ticker', columns='horizon', values='p_up')
    
    # Sort by average expected return
    ret_matrix['avg_ret'] = ret_matrix.mean(axis=1)
    ret_matrix = ret_matrix.sort_values('avg_ret', ascending=False)

    table = Table(
        title=f"🏛️ Alpha Surface: Return | Probability ({df['date'].iloc[0]})", 
        show_lines=True,
        caption="Format: [Expected Return] | [Prob(Up)]"
    )
    
    table.add_column("Ticker", style="bold white", no_wrap=True)
    horizons = sorted(df['horizon'].unique())
    for h in horizons:
        table.add_column(f"{h}d", justify="center")
    table.add_column("Avg Ret", style="bold yellow", justify="right")

    for ticker in ret_matrix.index:
        formatted_row = [ticker]
        for h in horizons:
            ret = ret_matrix.loc[ticker, h]
            prob = prob_matrix.loc[ticker, h]
            
            # Color logic for Return
            r_col = "green" if ret > 0 else "red"
            # Color logic for Probability (Conviction)
            # We use blue/cyan for high confidence (>55%)
            p_col = "cyan" if prob > 0.55 else "white"
            if prob < 0.45: p_col = "magenta" 

            cell_text = f"[{r_col}]{ret*100:+.1f}%[/{r_col}] | [{p_col}]{prob*100:.0f}%[/{p_col}]"
            formatted_row.append(cell_text)
        
        avg_ret = ret_matrix.loc[ticker, 'avg_ret']
        table.add_row(*formatted_row, f"{avg_ret*100:+.2f}%")

    console.print(table)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    args = parser.parse_args()
    display_comprehensive_matrix(args.file)