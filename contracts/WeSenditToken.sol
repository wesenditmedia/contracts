// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract WeSenditToken is ERC20, ERC20Capped, ERC20Burnable, Ownable {
  using SafeMath for uint256;
  
  uint256 public constant INITIAL_SUPPLY = 37500000 * 10**18;
  uint256 public constant TOTAL_SUPPLY = 1500000000 * 10**18;
  
  constructor(
    address tgeWallet
  ) ERC20("WeSendit", "WSI") ERC20Capped(TOTAL_SUPPLY) {
    ERC20._mint(tgeWallet, INITIAL_SUPPLY);
    ERC20._mint(address(this), TOTAL_SUPPLY.sub(INITIAL_SUPPLY));
  }

  // TODO: add 0.25% fee for holder transactions

  function distributeSaleToken(
    address seedSaleWallet,
    address privateSaleWallet
  ) public onlyOwner {
    _transfer(address(this), seedSaleWallet, 75000000 * 10**18); // 5%
    _transfer(address(this), privateSaleWallet, 120000000 * 10**18); // 8%
  }

  function distributeToken(
    address teamWallet,
    address advisorsWallet,
    address referralsWallet,
    address developmentWallet,
    address marketingWallet,
    address operationsWallet,
    address exchangeAndLiquidityWallet,
    address stakingRewardsWallet,
    address activityRewardsWallet,
    address airdropWallet,
    address generalReserveWallet
  ) public onlyOwner {
    _transfer(address(this), teamWallet, 180000000 * 10**18); // 12%
    _transfer(address(this), advisorsWallet, 75000000 * 10**18); // 5%
    _transfer(address(this), referralsWallet, 75000000 * 10**18); // 5%
    _transfer(address(this), developmentWallet, 225000000 * 10**18); // 15%
    _transfer(address(this), marketingWallet, 180000000 * 10**18); // 12%
    _transfer(address(this), operationsWallet, 150000000 * 10**18); // 10%
    _transfer(address(this), exchangeAndLiquidityWallet, 120000000 * 10**18); // 8%
    _transfer(address(this), stakingRewardsWallet, 120000000 * 10**18); // 8%
    _transfer(address(this), activityRewardsWallet, 45000000 * 10**18); // 3%
    _transfer(address(this), airdropWallet, 45000000 * 10**18); // 3%
    _transfer(address(this), generalReserveWallet, 52500000 * 10**18); // 3.5%
  }

  function _mint(address account, uint256 amount) internal virtual override(ERC20, ERC20Capped) {
    super._mint(account, amount);
  }
}
