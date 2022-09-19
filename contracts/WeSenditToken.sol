// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./BaseWeSenditToken.sol";

contract WeSenditToken is
    BaseWeSenditToken,
    ERC20Capped,
    ERC20Burnable,
    Ownable,
    ReentrancyGuard
{
    using SafeMath for uint256;

    constructor(address addressTotalSupply)
        ERC20("WeSendit", "WSI")
        ERC20Capped(TOTAL_SUPPLY)
        BaseWeSenditToken()
    {
        ERC20Capped._mint(addressTotalSupply, TOTAL_SUPPLY);
    }

    /**
     * Swap and Liquify
     */
    function _swapAndLiquify() private nonReentrant {
        // split the contract balance into halves
        uint256 half = swapAndLiquifyBalance().div(2);
        uint256 otherHalf = swapAndLiquifyBalance().sub(half);

        // capture the contract's current BNB balance.
        // this is so that we can capture exactly the amount of BNB that the
        // swap creates, and not make the liquidity event include any BNB that
        // has been manually sent to the contract
        uint256 initialBalance = address(this).balance;

        // swap tokens for BNB
        _swapTokensForBnb(half); // <- this breaks the BNB -> WSI swap when swap+liquify is triggered

        // how much BNB did we just swap into?
        uint256 newBalance = address(this).balance.sub(initialBalance);

        // add liquidity to uniswap
        _addLiquidity(otherHalf, newBalance);

        emit SwapAndLiquify(half, newBalance, otherHalf);
    }

    function _swapTokensForBnb(uint256 tokenAmount) private {
        // generate the uniswap pair path of token -> wbnb
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = pancakeRouter().WETH();

        _approve(address(this), address(pancakeRouter()), tokenAmount);

        // make the swap
        pancakeRouter().swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0, // accept any amount of BNB
            path,
            address(this),
            block.timestamp
        );
    }

    function _addLiquidity(uint256 tokenAmount, uint256 bnbAmount) private {
        // approve token transfer to cover all possible scenarios
        _approve(address(this), address(pancakeRouter()), tokenAmount);

        // add the liquidity
        pancakeRouter().addLiquidityETH{value: bnbAmount}(
            address(this),
            tokenAmount,
            0, // slippage is unavoidable
            0, // slippage is unavoidable
            owner(),
            block.timestamp
        );
    }

    /**
     * Transfers
     */
    function transfer(address to, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        address from = _msgSender();
        _preValidateTransfer(from, to, amount);
        _preTransfer(from, to, amount);

        uint256 tAmount = _transferHandleFees(from, to, amount);
        _transfer(from, to, tAmount);

        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        address spender = _msgSender();

        _spendAllowance(from, spender, amount);

        _preValidateTransfer(from, to, amount);
        _preTransfer(from, to, amount);

        uint256 tAmount = _transferHandleFees(from, to, amount);
        _transfer(from, to, tAmount);

        return true;
    }

    function _transferHandleFees(
        address from,
        address to,
        uint256 amount
    ) private returns (uint256 tAmount) {
        if (
            feesEnabled() &&
            !hasRole(ADMIN, _msgSender()) &&
            !hasRole(FEE_WHITELIST, _msgSender()) &&
            !hasRole(RECEIVER_FEE_WHITELIST, to) &&
            from != owner()
        ) {
            (uint256 tTotal, uint256 tFees) = dynamicFeeManager().reflectFees(
                address(this),
                from,
                to,
                amount,
                true
            );

            _transfer(from, address(dynamicFeeManager()), tFees);

            dynamicFeeManager().reflectFees(
                address(this),
                from,
                to,
                amount,
                false
            );

            return tTotal;
        } else {
            return amount;
        }
    }

    function _preValidateTransfer(
        address from,
        address to,
        uint256 amount
    ) private view returns (bool) {
        require(
            amount >= minTxAmount(),
            "WeSendit: amount is less than minTxAmount"
        );

        require(
            from == owner() ||
                !paused() ||
                hasRole(ADMIN, from) ||
                hasRole(BYPASS_PAUSE, from),
            "WeSendit: transactions are paused"
        );

        return true;
    }

    function _preTransfer(
        address from,
        address to,
        uint256 amount
    ) private {
        bool overMinTokenBalance = balanceOf(address(this)) >=
            swapAndLiquifyBalance();

        if (
            overMinTokenBalance &&
            !hasRole(ADMIN, from) &&
            !hasRole(BYPASS_SWAP_AND_LIQUIFY, from) &&
            swapAndLiquifyEnabled()
        ) {
            _swapAndLiquify();
        }
    }

    /**
     * Emergency
     */
    function emergencyWithdraw(uint256 amount) public override onlyRole(ADMIN) {
        address payable sender = payable(_msgSender());
        (bool sent, ) = sender.call{value: amount}("");
        require(sent, "WeSendit: Failed to send BNB");

        emit EmergencyWithdraw(_msgSender(), amount);
    }

    function emergencyWithdrawToken(uint256 amount)
        public
        override
        onlyRole(ADMIN)
    {
        _transfer(address(this), _msgSender(), amount);
        emit EmergencyWithdrawToken(_msgSender(), amount);
    }

    function _mint(address account, uint256 amount)
        internal
        virtual
        override(ERC20, ERC20Capped)
    {
        super._mint(account, amount);
    }
}
